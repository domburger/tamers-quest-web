import { aiEnabled, sanitizePromptText } from "./ai.js";
import { getAiConfig } from "./aiconfig.js";
import { getPrompt } from "./prompts.js";
import { runGenPipeline, buildIdeaSchema, buildAttributesSchema } from "./genPipeline.js";
import { getSchemaDesc } from "./schemaDesc.js";
import { buildHtmlModelSchema } from "../src/systems/htmlModel.js";
import { fillSlot } from "./text.js";
import { recordGenTrace, clip } from "./genTrace.js";
import { chatJson, toStrictSchema } from "./llm.js";

export function defaultCreateChat(model, temperature) {
  return {
    withStructuredOutput(schema, { name } = {}) {
      return {
        invoke: async (messages) => {
          const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
          const user = messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n\n");
          return chatJson({ model, temperature, system, user, schema, schemaName: name, maxTokens: 8000, timeoutMs: 120000 });
        },
      };
    },
  };
}

export { toStrictSchema };

export async function structuredInvoke(createChat, model, temp, schema, name, system, user) {
  const msgs = [{ role: "system", content: system }, { role: "user", content: user }];
  const invoke = async (t) => {
    const chat = await Promise.resolve(createChat(model, t));
    return await chat.withStructuredOutput(schema, { name, strict: true }).invoke(msgs);
  };
  const startedAt = Date.now();
  try {
    let out;
    try {
      out = await invoke(temp);
    } catch (e) {
      const msg = String((e && e.message) || "");
      if (/temperature|top_p/i.test(msg) && /unsupported|does not support|not support/i.test(msg)) out = await invoke(undefined);
      else throw e;
    }
    recordGenTrace({ stage: name, model, ok: true, ms: Date.now() - startedAt, system: clip(system), user: clip(user), output: clip(out, 8000) });
    return out;
  } catch (e) {
    recordGenTrace({ stage: name, model, ok: false, ms: Date.now() - startedAt, system: clip(system), user: clip(user), error: clip(String((e && e.message) || e), 1000) });
    throw e;
  }
}

export function existingNamesNote(existingNames, max = 160) {
  const names = [...(existingNames || [])].map((n) => String(n).replace(/\s+\d+$/, "")).filter(Boolean);
  const uniq = [...new Set(names)].slice(-max);
  if (!uniq.length) return "";
  return `

Monsters that ALREADY exist (choose a clearly different name and concept; never reuse one of these names or add a number to it): ${sanitizePromptText(uniq.join(", "), 4000)}`;
}

export function makeLiveStages(deps = {}) {
  const createChat = deps.createChat || defaultCreateChat;
  const cfg = (k) => getAiConfig(k);
  const stages = {
    idea: async (opts = {}) =>
      structuredInvoke(
        createChat, cfg("genIdeaModel"), cfg("genIdeaTemperature"),
        buildIdeaSchema(getSchemaDesc), "MonsterIdea",
        getPrompt("genIdeaSystem"),
        fillSlot(getPrompt("genIdeaUser"), "{hints}", "", "") + existingNamesNote(opts.existingNames),
      ),
    attributes: async (idea = {}, opts = {}) =>
      structuredInvoke(
        createChat, cfg("genAttributesModel"), cfg("genAttributesTemperature"),
        buildAttributesSchema(getSchemaDesc), "MonsterAttributes",
        getPrompt("genAttributesSystem"),
        fillSlot(
          fillSlot(getPrompt("genAttributesUser"), "{idea}", sanitizePromptText(JSON.stringify(idea || {}), 600), "Inspiration"),
          "{hints}", "", "",
        ) + existingNamesNote(opts.existingNames),
      ),
  };
  if (deps.withModel) {
    stages.model = async (ctx = {}, _opts = {}) => {
      const system = getPrompt("genModelSystem") + "\n\n" + getPrompt("genModelBrief");
      const modelSchema = buildHtmlModelSchema(getSchemaDesc);
      const user = fillSlot(
        fillSlot(getPrompt("genModelUser"), "{idea}", sanitizePromptText(JSON.stringify(ctx.idea || {}), 400), "Concept"),
        "{monster}", sanitizePromptText(JSON.stringify(monsterSummary(ctx.monster)), 600), "Monster",
      );
      let best = null, bestN = 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await structuredInvoke(createChat, cfg("genBuilderModel"), cfg("genBuilderTemperature"), modelSchema, "MonsterModel", system, user).catch(() => null);
        const n = r && typeof r.base === "string" ? r.base.trim().length : 0;
        if (n > bestN) { best = r; bestN = n; }
        if (bestN >= 300) break;
      }
      return best;
    };
  }
  return stages;
}

export async function aiGenerateMonsterV2(opts = {}, deps = {}) {
  if (!aiEnabled()) return null;
  const withModel = deps.withModel ?? (getAiConfig("genModel") === true || process.env.MONSTER_GEN_MODEL === "1");
  const res = await runGenPipeline(makeLiveStages({ ...deps, withModel }), opts);
  return res ? res.monster : null;
}

function monsterSummary(m) {
  const out = {};
  for (const [k, v] of Object.entries(m || {})) {
    if (k === "id" || v == null || v === "") continue;
    out[k] = v;
  }
  return out;
}
