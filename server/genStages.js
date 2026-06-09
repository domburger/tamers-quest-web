// P5-T4 — LIVE stages for the monster-generation pipeline. The pure orchestrator
// (genPipeline.js `runGenPipeline`) takes the stage functions as injected deps; this
// module provides the real, LangChain-backed implementations that plug into it.
//
// Each stage uses LangChain's STRUCTURED-OUTPUT feature (`withStructuredOutput`) against
// the stage schema from genPipeline.js — no ad-hoc JSON parsing. Model + sampling come
// from aiconfig.js (admin-tunable); prompts from prompts.js (admin-editable, P7-T5).
//
// The ChatOpenAI client is created through an injectable factory (`deps.createChat`) and
// `@langchain/openai` is loaded via a DYNAMIC import inside that factory — so this module
// (and its tests) load without the dependency or an API key, and unit tests inject a mock
// chat. The live path runs only when aiEnabled() and a key are present.

import { aiEnabled, sanitizePromptText } from "./ai.js";
import { getAiConfig } from "./aiconfig.js";
import { getPrompt } from "./prompts.js";
import { runGenPipeline, buildIdeaSchema, buildAttributesSchema, buildModelSchema } from "./genPipeline.js";
import { getSchemaDesc } from "./schemaDesc.js";

// Lazily construct a real LangChain ChatOpenAI (dynamic import → optional dependency).
async function defaultCreateChat() {
  const { ChatOpenAI } = await import("@langchain/openai");
  return new ChatOpenAI({
    model: getAiConfig("model"),
    temperature: getAiConfig("genTemperature"),
    apiKey: process.env.OPENAI_API_KEY,
  });
}

// One structured-output call: bind the schema, invoke with a system+user message pair.
async function structuredInvoke(chat, schema, name, system, user) {
  const msgs = [{ role: "system", content: system }, { role: "user", content: user }];
  try {
    return await chat.withStructuredOutput(schema, { name }).invoke(msgs);
  } catch (e) {
    // A flagship gpt-5.x locks temperature to its default and 400s our genTemperature; retry
    // once with a temperature-free client so any current model still generates. (Mocked chats
    // in tests don't throw this, so this fallback is prod-only.)
    const msg = String((e && e.message) || "");
    if (/temperature|top_p/i.test(msg) && /unsupported|does not support|not support/i.test(msg)) {
      const { ChatOpenAI } = await import("@langchain/openai");
      const plain = new ChatOpenAI({ model: getAiConfig("model"), apiKey: process.env.OPENAI_API_KEY });
      return await plain.withStructuredOutput(schema, { name }).invoke(msgs);
    }
    throw e;
  }
}

// Substitute a single {placeholder} in a prompt template with literal text. Uses a
// FUNCTION replacement so a "$" in the value (e.g. an LLM idea containing "$&" / "$`"
// / "$$") is inserted VERBATIM — a plain string replacement would interpret those as
// String.replace special patterns and corrupt the assembled prompt. (sanitizePromptText
// folds control chars but intentionally keeps "$", so the slot value can carry one.)
const fill = (tpl, key, val) => tpl.replace(key, () => val);

// Compact, sanitized targeting hints (element/biome/rarity) — mirrors gen.js's defense so
// a crafted hint can't break out of its prompt line (SEC-A3).
export function hintLine({ element, biome, rarity } = {}) {
  const S = sanitizePromptText;
  const rnum = Number(rarity);
  return [
    element ? `Element: ${S(element, 24)}.` : "",
    biome ? `Biome: ${S(biome, 40)}.` : "",
    Number.isFinite(rnum) ? `Target rarity (1-5): ${Math.max(1, Math.min(5, Math.round(rnum)))}.` : "",
  ].filter(Boolean).join(" ");
}

/**
 * Build the live {idea, attributes} stage functions for runGenPipeline. The chat client
 * is created once per pipeline run and shared across stages. `deps.createChat` overrides
 * the factory (tests pass a mock; prod uses the LangChain default).
 */
export function makeLiveStages(deps = {}) {
  const createChat = deps.createChat || defaultCreateChat;
  let chatPromise = null;
  const chat = () => (chatPromise ||= Promise.resolve(createChat()));
  const stages = {
    idea: async (opts = {}) =>
      structuredInvoke(
        await chat(), buildIdeaSchema(getSchemaDesc), "MonsterIdea",
        getPrompt("genIdeaSystem"),
        fill(getPrompt("genIdeaUser"), "{hints}", hintLine(opts) || "Choose fitting traits."),
      ),
    attributes: async (idea = {}, opts = {}) =>
      structuredInvoke(
        await chat(), buildAttributesSchema(getSchemaDesc), "MonsterAttributes",
        getPrompt("genAttributesSystem"),
        fill(
          fill(getPrompt("genAttributesUser"), "{idea}", sanitizePromptText(JSON.stringify(idea || {}), 600)),
          "{hints}", hintLine(opts),
        ),
      ),
  };
  // Stage 3 — Model (optional; an extra LLM call). Included only when requested, since the
  // renderer doesn't consume `monster.model` yet — gate via deps.withModel / MONSTER_GEN_MODEL=1.
  if (deps.withModel) {
    stages.model = async (ctx = {}, _opts = {}) =>
      structuredInvoke(
        await chat(), buildModelSchema(getSchemaDesc), "MonsterModel",
        getPrompt("genModelSystem"),
        fill(
          fill(getPrompt("genModelUser"), "{idea}", sanitizePromptText(JSON.stringify(ctx.idea || {}), 400)),
          "{monster}", sanitizePromptText(JSON.stringify(monsterSummary(ctx.monster)), 600),
        ),
      );
  }
  return stages;
}

/**
 * Generate one monster through the live multi-agent pipeline. Returns a schema-valid
 * MonsterType (attacks assigned) or null when AI is disabled / any stage fails.
 * @param {object} opts  gen opts ({ element?, biome?, rarity?, existingNames?, id? })
 * @param {object} [deps] { createChat } for tests
 */
export async function aiGenerateMonsterV2(opts = {}, deps = {}) {
  if (!aiEnabled()) return null;
  const withModel = deps.withModel ?? (getAiConfig("genModel") === true || process.env.MONSTER_GEN_MODEL === "1"); // Stage-3 opt-in (/admin or env)
  const res = await runGenPipeline(makeLiveStages({ ...deps, withModel }), opts);
  return res ? res.monster : null;
}

// A trimmed monster view for the Model agent's prompt (omit nulls/internal ids → fewer tokens).
function monsterSummary(m) {
  const out = {};
  for (const [k, v] of Object.entries(m || {})) {
    if (k === "id" || v == null || v === "") continue;
    out[k] = v;
  }
  return out;
}
