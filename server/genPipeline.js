// P5-T4 — multi-agent monster generation pipeline (foundation).
//
// The single `aiGenerateMonster` call in gen.js is being replaced by a STAGED
// pipeline so each concern is a small, separately-promptable agent with a
// STRUCTURED output (per the user spec, 2026-06-07):
//
//   Stage 1 — Idea:       a rough concept (theme / vibe / role / hints).
//   Stage 2 — Attributes: the idea → MonsterType fields (element, rarity, stats…).
//   Stage 3 — Model:      the procedural visual model + a few animations  (later).
//   Stage 4 — Review:     edit-only review pass (token-budget)            (later).
//
// This module is the ENGINE of that pipeline: a pure orchestrator that takes the
// stage functions as INJECTED dependencies, so it's fully unit-testable without
// LangChain, an API key, or live spend. The live stage implementations (LangChain
// `withStructuredOutput`, model/params from aiconfig.js, prompts from prompts.js)
// plug in on top of this in a later increment; Stages 3-4 append here too.
//
// The JSON schemas below double as (a) documentation of each stage's contract and
// (b) the schema later handed to the LLM's structured-output mode.

import { normalizeGeneratedMonster, assignAttacks } from "./gen.js";
import { getAttacks } from "../src/engine/gamedata.js";

// Mirrors gen.js STAT_KEYS (kept local so this stays a leaf module); the Attributes
// stage emits base<Stat> + <stat>Scaling1/2, which normalizeGeneratedMonster clamps.
const STAT_KEYS = ["Health", "Strength", "Defense", "Speed", "Power", "Energy", "Luck"];

function num(v, def, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}
function str(v, def) {
  return typeof v === "string" && v.trim() ? v.trim() : def;
}

// ── Stage 1 (Idea) structured-output contract ──────────────────────────────
// A lean concept the Attributes stage turns into real stats. Kept small on
// purpose — the creative spread lives in `theme`/`vibe`, the mechanical hints
// (element/rarity) only nudge Stage 2.
export const IDEA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    theme: { type: "string", description: "The creature's core concept, e.g. 'volcanic armored beetle'." },
    vibe: { type: "string", description: "Tone/feel, e.g. 'brutal and territorial' (keep it menacing, not cute)." },
    role: { type: "string", description: "Combat archetype, e.g. 'tank', 'glass-cannon', 'bruiser', 'evasive'." },
    elementHint: { type: "string", description: "Suggested element (free-form), or empty to let Stage 2 choose." },
    rarityHint: { type: "integer", minimum: 1, maximum: 5, description: "Suggested rarity 1-5 (higher = stronger/rarer)." },
  },
  required: ["theme", "vibe", "role"],
};

// ── Stage 2 (Attributes) structured-output contract ────────────────────────
// The MonsterType fields normalizeGeneratedMonster consumes. Built from STAT_KEYS
// so it can't drift from the stat set the engine actually reads.
export const ATTRIBUTES_SCHEMA = (() => {
  const props = {
    typeName: { type: "string", description: "Short evocative name (<=40 chars)." },
    element: { type: "string", description: "Free-form element string (e.g. Fire, Storm, Venom)." },
    rarity: { type: "integer", minimum: 1, maximum: 5 },
    size: { type: "integer", minimum: 1, maximum: 6 },
    description: { type: "string", description: "1-3 sentence bestiary blurb." },
    passiveEffect: { type: "string", description: "Short passive-ability description, or empty." },
    activeEffect: { type: "string", description: "Short active-ability description, or empty." },
  };
  for (const k of STAT_KEYS) {
    const lk = k.toLowerCase();
    props[`base${k}`] = { type: "integer", minimum: 1, maximum: 400, description: `Base ${lk} (1-400, ~60 typical).` };
    props[`${lk}Scaling1`] = { type: "number", minimum: 0, maximum: 5 };
    props[`${lk}Scaling2`] = { type: "number", minimum: 0, maximum: 1.3 };
  }
  return { type: "object", additionalProperties: false, properties: props, required: ["typeName", "element", "rarity"] };
})();

// Coerce arbitrary Stage-1 output into a guaranteed-valid Idea (same defensive
// style as normalizeGeneratedMonster — the live LLM stage validates via structured
// output, but we never trust raw model JSON downstream).
export function coerceIdea(raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    theme: str(r.theme, "a wild cave creature").slice(0, 120),
    vibe: str(r.vibe, "menacing and territorial").slice(0, 120),
    role: str(r.role, "bruiser").slice(0, 40),
    elementHint: str(r.elementHint, "").slice(0, 24),
    rarityHint: Math.round(num(r.rarityHint, 2, 1, 5)),
  };
}

/**
 * Run the staged generation pipeline. PURE w.r.t. the LLM: every stage is an
 * injected async function, so tests pass deterministic mocks and prod passes the
 * live LangChain-backed stages.
 *
 * @param {object} stages
 * @param {(opts) => Promise<object>} stages.idea        Stage 1 → raw idea
 * @param {(idea, opts) => Promise<object>} stages.attributes  Stage 2 → raw MonsterType fields
 * @param {object} [opts]  threaded to every stage + to normalizeGeneratedMonster
 *   (existingNames:Set, biome, id, attackPool, rand). Stages may read it for hints.
 * @returns {Promise<{monster: object, idea: object}|null>} the normalized,
 *   attack-assigned MonsterType + the idea it came from, or null if a stage fails.
 */
export async function runGenPipeline(stages = {}, opts = {}) {
  if (typeof stages.idea !== "function" || typeof stages.attributes !== "function") {
    throw new TypeError("runGenPipeline: stages.idea and stages.attributes must be functions");
  }
  try {
    const idea = coerceIdea(await stages.idea(opts));
    const attrRaw = await stages.attributes(idea, opts);
    if (!attrRaw || typeof attrRaw !== "object") return null;
    const monster = normalizeGeneratedMonster(attrRaw, opts);
    assignAttacks(monster, opts.attackPool || getAttacks(), opts.rand || Math.random);
    return { monster, idea };
  } catch (e) {
    console.error("[genPipeline] generation failed:", e.message);
    return null;
  }
}
