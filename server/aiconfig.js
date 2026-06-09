// Admin-editable AI model + generation parameters (extends the P7-T5 prompt
// editor). The hard-coded defaults here are the single source of truth; admins
// override any field in the admin panel and the override is DB-persisted (settings
// id=3) and applied live. ai.js (combat resolution) and gen.js (monster
// generation) read the active values via getAiConfig() — so the model, sampling
// temperature, etc. are all steerable from /admin without a redeploy.

import { loadAiConfig, saveAiConfig } from "./db.js";

export const DEFAULT_AI_CONFIG = {
  model: "gpt-5.4-mini",   // OpenAI chat model id (admin-selectable). A CURRENT model that's cheap +
  //                          fast for per-turn combat and accepts a custom temperature (so it's a
  //                          single request/turn). Pick gpt-5.5 in /admin for max quality.
  combatTemperature: 0.7,  // ai.js turn resolution sampling
  // Task 78: cap how much HP a monster can LOSE in a single AI-resolved turn, as a
  // fraction of its MAX HP — a guard against wildly-swingy turns (a full-HP monster can't
  // be one-shot) while still letting a weakened monster be KO'd. Defaults to 1 (OFF = no
  // live change); lower it in /admin (e.g. 0.6) "if needed" when turns swing too hard.
  combatMaxTurnDamageFrac: 1,
  genTemperature: 0.9,     // gen.js monster generation sampling (a touch more creative)
  maxTokens: 400,          // response cap for combat turns
  topP: 1,                 // nucleus sampling (1 = off)
  // P5-T4 monster-gen pipeline controls (admin-tunable live, no redeploy). "v2" = the
  // multi-agent Idea→Attributes pipeline; genModel/genReview add the optional Stage-3
  // (visual model) / Stage-4 (review) agents (extra LLM calls each). The env vars
  // MONSTER_GEN_PIPELINE=v2 / MONSTER_GEN_MODEL=1 / MONSTER_GEN_REVIEW=1 still work as
  // overrides (either source enables), so prod can flip these from /admin or env.
  genPipeline: "v2",       // "v1" (single call) | "v2" (multi-agent). DEFAULT v2 (2026-06-09):
  // the multi-agent Idea→Attributes pipeline produces the per-monster genAttacks
  // (AI-authored title + judge-readable description) + visualDescription the design spec
  // requires; v1 only made legacy pool-attack refs. v2 monsters fight with their own attacks.
  genModel: false,         // run the Stage-3 Model agent (v2 only)
  genReview: false,        // run the Stage-4 Review agent (v2 only)
  // Structured Fight-Judgement judge (plan "Implement combat as per description below"). DEFAULT
  // ON (2026-06-09): the v2 judge takes full monster descriptions + passives (+ transcript) and
  // returns per-field DELTAS/rewrites + a special-actions channel (server/judge.js). It reads the
  // descriptions of the monster's offered moves — including the AI-authored genAttacks — to
  // resolve each turn. Set false in /admin to fall back to the v1 absolute-value judge.
  combatJudgeV2: true,
};

// Chat models surfaced as quick-picks in the admin dropdown, NEWEST FIRST. The field is also
// free-text, so any current OpenAI chat model id can be entered. VERIFIED LIVE 2026-06-09 by
// issuing the game's ACTUAL Chat Completions call (json_object + sampling) with the production
// key — every id below resolves a turn end-to-end. (The previous list "verified" only that the
// ids existed in /v1/models, but 6 of them 400'd at call time — `max_tokens` is rejected by
// gpt-5.x and flagship gpt-5.x lock `temperature`. The shim in server/openai.js fixes both:
// it sends `max_completion_tokens` and drops temperature/top_p for the locked models — so the
// quick-picks all work.) EXCLUDED on purpose: the *-pro / *-codex / o-series variants use a
// different endpoint or lock params and would error here. A dead/unsupported id still surfaces
// a diagnosable OpenAI error in the logs rather than failing silently.
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
const SPEC = {
  model: (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : undefined),
  combatTemperature: (v) => num(v, 0, 2),
  combatMaxTurnDamageFrac: (v) => num(v, 0.1, 1),
  genTemperature: (v) => num(v, 0, 2),
  maxTokens: (v) => int(v, 1, 4000),
  topP: (v) => num(v, 0, 1),
  genPipeline: (v) => (v === "v1" || v === "v2" ? v : undefined),
  genModel: bool,
  genReview: bool,
  combatJudgeV2: bool,
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
