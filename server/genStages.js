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
import { runGenPipeline, buildIdeaSchema, buildAttributesSchema } from "./genPipeline.js"; // TQ-245: model stage now uses SVG_MODEL_SCHEMA (svgModel.js), not buildModelSchema
import { getSchemaDesc } from "./schemaDesc.js";
import { svgModelBrief, SVG_MODEL_SCHEMA } from "../src/systems/svgModel.js"; // TQ-245: SVG builder contract + brief
import { fillSlot } from "./text.js";

// Build a LangChain ChatOpenAI for a given PHASE model + temperature (dynamic import → optional
// dependency). Each generation phase configures its own model + sampling (admin-tunable).
async function defaultCreateChat(model, temperature) {
  const { ChatOpenAI } = await import("@langchain/openai");
  return new ChatOpenAI({ model, temperature, apiKey: process.env.OPENAI_API_KEY });
}

// One structured-output call for a phase. `createChat(model, temp)` is the factory (tests inject a
// mock; prod uses defaultCreateChat). On a temperature-lock 400 (some flagship models lock it),
// retry once with the SAME model but no temperature so any chosen model still generates.
async function structuredInvoke(createChat, model, temp, schema, name, system, user) {
  const msgs = [{ role: "system", content: system }, { role: "user", content: user }];
  try {
    const chat = await Promise.resolve(createChat(model, temp));
    return await chat.withStructuredOutput(schema, { name }).invoke(msgs);
  } catch (e) {
    const msg = String((e && e.message) || "");
    if (/temperature|top_p/i.test(msg) && /unsupported|does not support|not support/i.test(msg)) {
      const chat = await Promise.resolve(createChat(model, undefined));
      return await chat.withStructuredOutput(schema, { name }).invoke(msgs);
    }
    throw e;
  }
}

// fillSlot (shared in text.js) inserts a slot value ROBUST to admin prompt overrides that drop
// the {placeholder}: replace when present, else APPEND (labelled) so idea/hints/monster context
// is never silently lost — the cause of generated monsters ignoring their element + converging.

// Compact, sanitized targeting hints (element/biome/rarity) — mirrors gen.js's defense so
// a crafted hint can't break out of its prompt line (SEC-A3).
export function hintLine({ element, biome, rarity, archetype } = {}) {
  const S = sanitizePromptText;
  const rnum = Number(rarity);
  return [
    // Authoritative: a small model otherwise ignores a soft element hint and defaults to
    // earth/shadow. Force the monster to be BUILT AROUND this element (theme, palette, attacks).
    element ? `Element: ${S(element, 24)} — build the monster AROUND this element (its theme, palette and attacks must express ${S(element, 24)}); do NOT drift to a different element.` : "",
    biome ? `Habitat: ${S(biome, 40)}.` : "",
    archetype ? `Lean toward a ${S(archetype, 16)} silhouette.` : "",
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
  const cfg = (k) => getAiConfig(k); // each phase reads its own model + temperature dial
  const stages = {
    idea: async (opts = {}) =>
      structuredInvoke(
        createChat, cfg("genIdeaModel"), cfg("genIdeaTemperature"),
        buildIdeaSchema(getSchemaDesc), "MonsterIdea",
        getPrompt("genIdeaSystem"),
        fillSlot(getPrompt("genIdeaUser"), "{hints}", hintLine(opts) || "Choose fitting traits.", "Constraints"),
      ),
    attributes: async (idea = {}, opts = {}) =>
      structuredInvoke(
        createChat, cfg("genAttributesModel"), cfg("genAttributesTemperature"),
        buildAttributesSchema(getSchemaDesc), "MonsterAttributes",
        getPrompt("genAttributesSystem"),
        fillSlot(
          fillSlot(getPrompt("genAttributesUser"), "{idea}", sanitizePromptText(JSON.stringify(idea || {}), 600), "Inspiration"),
          "{hints}", hintLine(opts), "Constraints",
        ),
      ),
  };
  // Stage 3 — Model / visual BUILDER (an extra LLM call; gate via deps.withModel /
  // aiconfig.genModel / MONSTER_GEN_MODEL=1). It composes the creature's appearance FROM SCRATCH
  // as a list of 2D shape primitives (no template) → the monster's one reused sprite. The
  // authored-model brief (the exact 128-frame coordinate system + the primitive set the renderer
  // can draw) is appended to the system prompt programmatically, so the builder always targets
  // what modelRender can execute even if genModelSystem is overridden in /admin.
  if (deps.withModel) {
    stages.model = async (ctx = {}, _opts = {}) => {
      const system = getPrompt("genModelSystem") + "\n\n" + svgModelBrief(); // TQ-245: SVG render-target brief
      const user = fillSlot(
        fillSlot(getPrompt("genModelUser"), "{idea}", sanitizePromptText(JSON.stringify(ctx.idea || {}), 400), "Concept"),
        "{monster}", sanitizePromptText(JSON.stringify(monsterSummary(ctx.monster)), 600), "Monster",
      );
      // TQ-245: the builder occasionally returns an empty/sparse base (smaller models do this a fraction
      // of the time). Retry a couple of times and keep the richest result (longest base SVG), so a
      // generated monster reliably gets a real authored visual instead of degrading to the archetype.
      let best = null, bestN = 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await structuredInvoke(createChat, cfg("genBuilderModel"), cfg("genBuilderTemperature"), SVG_MODEL_SCHEMA, "MonsterModel", system, user).catch(() => null);
        const n = r && typeof r.base === "string" ? r.base.trim().length : 0;
        if (n > bestN) { best = r; bestN = n; }
        if (bestN >= 300) break; // a substantial base SVG document
      }
      return best;
    };
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
