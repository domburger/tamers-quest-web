// P5-T4 — multi-agent monster generation pipeline (foundation).
//
// The single `aiGenerateMonster` call in gen.js is being replaced by a STAGED
// pipeline so each concern is a small, separately-promptable agent with a
// STRUCTURED output (per the user spec, 2026-06-07):
//
//   Stage 1 — Idea:       a rough concept (theme / vibe / role / hints).
//   Stage 2 — Attributes: the idea → MonsterType fields (rarity, stats…).
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
import { coerceHtmlModel, HTML_SCHEMA_DESC_DEFAULTS } from "../src/systems/htmlModel.js"; // TQ-259: HTML/CSS coerce + builder field-desc defaults (swap off SVG, TQ-255)

// Mirrors gen.js STAT_KEYS (kept local so this stays a leaf module); the Attributes
// stage emits base<Stat> + <stat>Scaling1/2, which normalizeGeneratedMonster clamps.
const STAT_KEYS = ["Health", "Strength", "Defense", "Speed", "Power", "Energy", "Luck"];

// ── Schema field DESCRIPTIONS (admin-editable) ──────────────────────────────
// Each structured-output schema property carries a `description` that is sent to the
// LLM to guide what it puts in that field — so these are effectively part of the
// generation prompt. They live here as the single source of truth (defaults); the
// admin override registry (server/schemaDesc.js) layers edits on top, and the schema
// BUILDER functions below read them through an injected provider so an override applies
// live. `{stat}` in attributes.baseStat is substituted per stat (health/strength/…).
export const SCHEMA_DESC_DEFAULTS = {
  "idea.inspiration": "2-4 words to characterize the monster, e.g. 'volcanic armored beetle'.",
  "attributes.typeName": "Short evocative name (<=40 chars).",
  "attributes.description": "1-3 sentence bestiary blurb.",
  "attributes.passiveEffect": "Short passive-ability description, or empty.",
  "attributes.attacks": "EXACTLY 4 distinct attacks. Each: a 2-3 word title + a one-sentence description that BOTH reads to the player AND tells the fight-judge how to resolve it (its effect, rough power, any status it inflicts).",
  "attributes.attackTitle": "2-3 word attack name.",
  "attributes.attackDescription": "One sentence: what the attack does in a fight (effect / rough power / any status) - player- and judge-readable.",
  "attributes.visualDescription": "A vivid 1-2 sentence VISUAL description of the creature for the builder agent: silhouette/body plan, palette, and distinctive BRUTAL features.",
  "attributes.baseStat": "Base {stat} (1-400, ~60 typical).",
  // Visual BUILDER (Phase 3) per-state descriptions (model.base/idle/attack/move). The defaults live
  // with the contract in src/systems/htmlModel.js (HTML_SCHEMA_DESC_DEFAULTS, TQ-259); spread in here
  // so the override registry + admin editor cover them. Safety (forbidden tags / canvas size) is NOT
  // editable — it's re-asserted by htmlModelBrief() + enforced by the TQ-261 sanitizer.
  ...HTML_SCHEMA_DESC_DEFAULTS,
};
// Default description provider — returns the hardcoded default for a key. The live stages
// pass server/schemaDesc.js's getSchemaDesc instead (override-aware).
const defaultDesc = (k) => SCHEMA_DESC_DEFAULTS[k] ?? "";

function str(v, def) {
  return typeof v === "string" && v.trim() ? v.trim() : def;
}

// ── Stage 1 (Idea) structured-output contract ──────────────────────────────
// The inspiration agent's ONLY output is `inspiration` — a 2-4 word characterization
// (user spec 2026-06-12). No vibe/role/element/rarity hints: the Attributes stage
// designs the whole monster from those words alone.
export function buildIdeaSchema(d = defaultDesc) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      inspiration: { type: "string", description: d("idea.inspiration") },
    },
    required: ["inspiration"],
  };
}
export const IDEA_SCHEMA = buildIdeaSchema();

// ── Stage 2 (Attributes) structured-output contract ────────────────────────
// The MonsterType fields normalizeGeneratedMonster consumes. Built from STAT_KEYS
// so it can't drift from the stat set the engine actually reads.
export function buildAttributesSchema(d = defaultDesc) {
  const props = {
    typeName: { type: "string", description: d("attributes.typeName") },
    rarity: { type: "integer", minimum: 1, maximum: 5 },
    size: { type: "integer", minimum: 1, maximum: 6 },
    description: { type: "string", description: d("attributes.description") },
    passiveEffect: { type: "string", description: d("attributes.passiveEffect") },
    // Spec: the designer GENERATES the 4 attacks (title + a judge-readable & player-readable
    // description) and a VISUAL DESCRIPTION forwarded to the builder agent.
    attacks: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      description: d("attributes.attacks"),
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", description: d("attributes.attackTitle") },
          description: { type: "string", description: d("attributes.attackDescription") },
        },
        required: ["title", "description"],
      },
    },
    visualDescription: { type: "string", description: d("attributes.visualDescription") },
  };
  for (const k of STAT_KEYS) {
    const lk = k.toLowerCase();
    props[`base${k}`] = { type: "integer", minimum: 1, maximum: 400, description: d("attributes.baseStat").replace(/\{stat\}/g, lk) };
    props[`${lk}Scaling1`] = { type: "number", minimum: 0, maximum: 5 };
    props[`${lk}Scaling2`] = { type: "number", minimum: 0, maximum: 1.3 };
  }
  return { type: "object", additionalProperties: false, properties: props, required: ["typeName", "rarity"] };
}
export const ATTRIBUTES_SCHEMA = buildAttributesSchema();

// Coerce arbitrary Stage-1 output into a guaranteed-valid Idea (same defensive
// style as normalizeGeneratedMonster — the live LLM stage validates via structured
// output, but we never trust raw model JSON downstream).
export function coerceIdea(raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  // Stage 1's ONLY output is `inspiration` — a 2-4 word characterization (user spec 2026-06-12).
  // Accept a legacy `theme` key as a fallback INPUT so older overrides/tests still resolve to a
  // usable value, but emit nothing but `inspiration` downstream.
  const inspiration = str(r.inspiration, str(r.theme, "a wild cave creature")).slice(0, 120);
  return { inspiration };
}

// ── Stage 3 (Model) structured-output contract ─────────────────────────────
// The live builder STAGE uses the HTML/CSS contract (buildHtmlModelSchema + the editable genModelBrief
// prompt, see genStages.js) and the pipeline attaches monster.html via coerceHtmlModel below. The SVG
// builder path (svgModel.js / monster.svg) was removed in TQ-264; the older authored-shapes system went
// in TQ-242.

/**
 * Run the staged generation pipeline. PURE w.r.t. the LLM: every stage is an
 * injected async function, so tests pass deterministic mocks and prod passes the
 * live LangChain-backed stages.
 *
 * @param {object} stages
 * @param {(opts) => Promise<object>} stages.idea        Stage 1 → raw idea
 * @param {(idea, opts) => Promise<object>} stages.attributes  Stage 2 → raw MonsterType fields
 * @param {(ctx, opts) => Promise<object>} [stages.model]  Stage 3 (optional) → raw model spec
 *   (ctx = { idea, monster }); result is coerced and attached as `monster.model`.
 * @param {object} [opts]  threaded to every stage + to normalizeGeneratedMonster
 *   (existingNames:Set, biome, id, attackPool, rand). Stages may read it for hints.
 * @returns {Promise<{monster: object, idea: object, model: object|null}|null>} the
 *   normalized, attack-assigned MonsterType (+ `.model` if Stage 3 ran) + the idea,
 *   or null if a stage fails.
 */
export async function runGenPipeline(stages = {}, opts = {}) {
  if (typeof stages.idea !== "function" || typeof stages.attributes !== "function") {
    throw new TypeError("runGenPipeline: stages.idea and stages.attributes must be functions");
  }
  try {
    const idea = coerceIdea(await stages.idea(opts));
    const attrRaw = await stages.attributes(idea, opts);
    if (!attrRaw || typeof attrRaw !== "object") return null;
    // TQ-326: pass the Idea inspiration so a blank/missing typeName recovers a real, thematic name
    // (title-cased inspiration) instead of the old silent "Wild Beast" placeholder. normalize returns
    // null only if there's NO name AND no inspiration to recover one — reject the generation then
    // (no pool-add, no persist) rather than polluting the pool.
    let monster = normalizeGeneratedMonster(attrRaw, { ...opts, inspiration: idea.inspiration });
    if (!monster) { console.warn("[genPipeline] generation rejected: no typeName"); return null; }
    assignAttacks(monster, opts.attackPool || getAttacks(), opts.rand || Math.random);
    // Stage 3 (optional) — the Model agent designs the procedural visual (monster.model.shapes)
    // for the renderer. The pipeline still succeeds without it (deterministic spritegen stays the
    // fallback), so existing {idea, attributes}-only callers are unaffected. ANIMATIONS are NOT
    // authored per-monster: every monster declares the standard idle/walk/attack set
    // (monster.animations, stamped by normalizeGeneratedMonster) and those clips are procedural —
    // src/systems/monsterAnim.js applied to the baked sprite by src/render/monster.js drawMonster.
    let model = null;
    if (typeof stages.model === "function") {
      model = coerceHtmlModel(await stages.model({ idea, monster }, opts));
      if (model) monster.html = model; // TQ-259: attach the HTML/CSS model (per-state markup) — swaps off monster.svg (TQ-255)
    }
    return { monster, idea, model };
  } catch (e) {
    console.error("[genPipeline] generation failed:", e.message);
    return null;
  }
}
