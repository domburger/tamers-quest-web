// Admin-editable AI model + generation parameters (extends the P7-T5 prompt
// editor). The hard-coded defaults here are the single source of truth; admins
// override any field in the admin panel and the override is DB-persisted (settings
// id=3) and applied live. ai.js (combat resolution) and gen.js (monster
// generation) read the active values via getAiConfig() — so the model, sampling
// temperature, etc. are all steerable from /admin without a redeploy.

import { loadAiConfig, saveAiConfig } from "./db.js";

// All settings are admin-editable (DB-persisted, applied live). Generation is organized BY PHASE:
// each pipeline stage has its own model + temperature dial so e.g. the visual Builder can run a
// strong model while the cheap text phases stay on mini.
export const DEFAULT_AI_CONFIG = {
  // ── Combat (per-turn AI resolution; server/ai.js + server/judge.js) ──
  model: "gpt-5.4-mini",        // combat-judge model (cheap/fast per turn; pick gpt-5.5 for max quality)
  combatTemperature: 0.7,       // turn-resolution sampling
  combatMaxTurnDamageFrac: 1,   // cap HP a monster can LOSE in one AI turn, as a frac of max (1 = off)
  maxTokens: 400,               // response cap for combat turns
  topP: 1,                      // nucleus sampling (1 = off)
  combatJudgeV2: true,          // structured delta/rewrite judge (false → v1 absolute-value judge)

  // ── Monster generation — PER PHASE (multi-agent pipeline: Idea → Attributes → Builder) ──
  // Attributes produces the genAttacks (the monster's combat moves) + a visualDescription; the
  // visual BUILDER composes the creature FROM SCRATCH as free-form SVG markup (src/systems/
  // svgModel.js). A small model authors the visual unreliably (blank/sparse monsters), so the Builder
  // defaults to a capable model while the cheaper text phases stay on mini.
  genIdeaModel: "gpt-5.4-mini",        genIdeaTemperature: 0.9,
  genAttributesModel: "gpt-5.4-mini",  genAttributesTemperature: 0.9,
  genBuilderModel: "gpt-5.4",          genBuilderTemperature: 0.9,
  genModel: true,               // run the Builder phase (off → archetype-fallback visual; saves a call)

  // ── Monster EVOLUTION (TQ-551) — the fixed-level agent that EDITS an existing monster in place via a
  // replace tool (model markup + attributes). Defaults to the frontier model: it must reason over the
  // creature's current HTML to author precise, grown-up find/replace edits, so quality matters most here.
  evolveModel: "gpt-5.5",              evolveTemperature: 0.9,

  // ── Item generation — PER PHASE (Inspiration → Designer) ──
  // A varied combat-item toolkit (heal / energy / cleanse / buff + damage / debuff). Simple text,
  // so the cheap model is fine.
  itemInspirationModel: "gpt-5.4-mini", itemInspirationTemperature: 0.9,
  itemDesignerModel: "gpt-5.4-mini",    itemDesignerTemperature: 0.9,
  itemBuilderModel: "gpt-5.4-mini",     itemBuilderTemperature: 0.9, // TQ-390: item ICON visual-builder agent (mirrors tileBuilder, TQ-372)
  itemBuilderEnabled: true,

  // ── Biome generation — PER PHASE (Inspiration → Designer) ──
  // Themed map regions (name + minimap tint). Simple data, so the cheap model is fine.
  biomeInspirationModel: "gpt-5.4-mini", biomeInspirationTemperature: 0.9,
  biomeDesignerModel: "gpt-5.4-mini",    biomeDesignerTemperature: 0.9,

  // ── Floor-tile generation — PER PHASE (Inspiration → Designer → Builder) ──
  // Ground types within a biome (name + base colour the renderer textures). Cheap model is fine.
  tileInspirationModel: "gpt-5.4-mini",  tileInspirationTemperature: 0.9,
  tileDesignerModel: "gpt-5.4-mini",     tileDesignerTemperature: 0.9,
  // TQ-372: the tile visual BUILDER is its own agent (authors the ground texture as layered paint).
  // Default on so generated tiles keep an authored visual; off → flat base colour + procedural grain.
  tileBuilderModel: "gpt-5.4-mini",      tileBuilderTemperature: 0.9,
  tileBuilderEnabled: true,

  // ── Tile MODIFIER toggles (TQ-361) — gate whether new tiles GENERATE each per-tile modifier.
  // Slipperiness + speed are OFF by user directive; emissiveness (a benign glow flavour) stays on.
  // NOTE: the slipperiness/speed EFFECTS are not applied in movement anyway (per-tile speed + slip
  // were removed 2026-06-09) — these toggles control the generated DATA, so OFF keeps the modifier
  // inert at the source (and ON readies the data for if/when an effect is reintroduced).
  tileSlipperinessEnabled: false,
  tileSpeedModifierEnabled: false,
  tileEmissivenessEnabled: true,
};

// Chat models offered as quick-picks for EVERY model dial (combat + each generation phase). The
// field is also free-text, so any current OpenAI chat model id works. The gpt-5.x frontier ids
// were confirmed against the OpenAI models docs (2026-06-10): gpt-5.5 / gpt-5.4 / gpt-5.4-mini /
// gpt-5.4-nano. The gpt-5-chat-latest + gpt-4.1 / gpt-4o families remain available (live-verified
// earlier via the game's actual Chat Completions call). server/openai.js handles the param drift
// (max_completion_tokens; drops temperature/top_p for models that lock them) so all resolve.
export const MODEL_OPTIONS = [
  "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano",
  "gpt-5-chat-latest",
  "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
  "gpt-4o", "gpt-4o-mini",
];

// Per-field validation/coercion. Returns a clean value, or undefined to reject.
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : undefined; };
const int = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : undefined; };
const bool = (v) => (v === true || v === "true" || v === "1" || v === 1) ? true : (v === false || v === "false" || v === "0" || v === 0) ? false : undefined;
const modelOf = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : undefined);
const tempOf = (v) => num(v, 0, 2);
const SPEC = {
  // Combat
  model: modelOf,
  combatTemperature: tempOf,
  combatMaxTurnDamageFrac: (v) => num(v, 0.1, 1),
  maxTokens: (v) => int(v, 1, 4000),
  topP: (v) => num(v, 0, 1),
  combatJudgeV2: bool,
  // Monster generation phases
  genIdeaModel: modelOf, genIdeaTemperature: tempOf,
  genAttributesModel: modelOf, genAttributesTemperature: tempOf,
  genBuilderModel: modelOf, genBuilderTemperature: tempOf,
  genModel: bool,
  // Monster evolution (TQ-551)
  evolveModel: modelOf, evolveTemperature: tempOf,
  // Item generation phases
  itemInspirationModel: modelOf, itemInspirationTemperature: tempOf,
  itemDesignerModel: modelOf, itemDesignerTemperature: tempOf,
  itemBuilderModel: modelOf, itemBuilderTemperature: tempOf, itemBuilderEnabled: bool, // TQ-390: item visual builder agent
  // Biome generation phases
  biomeInspirationModel: modelOf, biomeInspirationTemperature: tempOf,
  biomeDesignerModel: modelOf, biomeDesignerTemperature: tempOf,
  // Floor-tile generation phases
  tileInspirationModel: modelOf, tileInspirationTemperature: tempOf,
  tileDesignerModel: modelOf, tileDesignerTemperature: tempOf,
  tileBuilderModel: modelOf, tileBuilderTemperature: tempOf, tileBuilderEnabled: bool, // TQ-372: visual builder agent
  // Tile modifier toggles (TQ-361)
  tileSlipperinessEnabled: bool,
  tileSpeedModifierEnabled: bool,
  tileEmissivenessEnabled: bool,
};

let overrides = {};

export async function initAiConfig() {
  try { overrides = (await loadAiConfig()) || {}; }
  catch { overrides = {}; }
}

// Active value for one key: a valid override if present, else the default.
export function getAiConfig(key) {
  if (key in overrides && SPEC[key]) {
    const clean = SPEC[key](overrides[key]);
    if (clean !== undefined) return clean;
  }
  return DEFAULT_AI_CONFIG[key];
}

// For the admin editor: per-field current/default/overridden + the model options.
export function allAiConfig() {
  const fields = {};
  for (const k of Object.keys(DEFAULT_AI_CONFIG)) {
    fields[k] = { current: getAiConfig(k), default: DEFAULT_AI_CONFIG[k], overridden: k in overrides };
  }
  return { fields, modelOptions: MODEL_OPTIONS };
}

// Apply a validated/clamped patch. A null/empty value resets that key to default.
export async function setAiConfig(patch) {
  if (patch && typeof patch === "object") {
    for (const k of Object.keys(DEFAULT_AI_CONFIG)) {
      if (!(k in patch)) continue;
      const v = patch[k];
      if (v == null || v === "") { delete overrides[k]; continue; }
      const clean = SPEC[k](v);
      if (clean !== undefined) overrides[k] = clean;
    }
  }
  await saveAiConfig(overrides).catch((e) => console.error("[aiconfig] save:", e.message));
  return allAiConfig();
}
