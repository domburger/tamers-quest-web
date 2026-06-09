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
import { BODY_SHAPES, FEATURE_VOCAB, canonicalFeatures } from "../src/systems/monsterModel.js";

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
  "idea.vibe": "Tone/feel, e.g. 'brutal and territorial' (keep it menacing, not cute).",
  "idea.role": "Combat archetype, e.g. 'tank', 'glass-cannon', 'bruiser', 'evasive'.",
  "idea.elementHint": "Suggested element (free-form), or empty to let Stage 2 choose.",
  "idea.rarityHint": "Suggested rarity 1-5 (higher = stronger/rarer).",
  "attributes.typeName": "Short evocative name (<=40 chars).",
  "attributes.element": "Free-form element string (e.g. Fire, Storm, Venom).",
  "attributes.description": "1-3 sentence bestiary blurb.",
  "attributes.passiveEffect": "Short passive-ability description, or empty.",
  "attributes.activeEffect": "Short active-ability description, or empty.",
  "attributes.attacks": "EXACTLY 4 distinct attacks. Each: a 2-3 word title + a one-sentence description that BOTH reads to the player AND tells the fight-judge how to resolve it (its effect, element, rough power, any status it inflicts).",
  "attributes.attackTitle": "2-3 word attack name.",
  "attributes.attackDescription": "One sentence: what the attack does in a fight (effect / element / rough power / any status) - player- and judge-readable.",
  "attributes.visualDescription": "A vivid 1-2 sentence VISUAL description of the creature for the builder agent: silhouette/body plan, palette, and distinctive BRUTAL features.",
  "attributes.baseStat": "Base {stat} (1-400, ~60 typical).",
  "model.bodyShape": "The ONE silhouette archetype the renderer rigs to that best fits the creature (see the render-target brief for what each looks like).",
  "model.palettePrimary": "Main body colour as #hex or a colour word (e.g. crimson, ash, bone); empty = use the element's palette.",
  "model.features": "1-3 distinctive features the renderer can draw, chosen from the allowed feature list in the render-target brief (e.g. horns, plates, wings). Other words are ignored.",
};
// Default description provider — returns the hardcoded default for a key. The live stages
// pass server/schemaDesc.js's getSchemaDesc instead (override-aware).
const defaultDesc = (k) => SCHEMA_DESC_DEFAULTS[k] ?? "";

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
export function buildIdeaSchema(d = defaultDesc) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      // Spec: the inspiration agent gives 2-4 words "to characterize the monster".
      inspiration: { type: "string", description: d("idea.inspiration") },
      vibe: { type: "string", description: d("idea.vibe") },
      role: { type: "string", description: d("idea.role") },
      elementHint: { type: "string", description: d("idea.elementHint") },
      rarityHint: { type: "integer", minimum: 1, maximum: 5, description: d("idea.rarityHint") },
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
    element: { type: "string", description: d("attributes.element") },
    rarity: { type: "integer", minimum: 1, maximum: 5 },
    size: { type: "integer", minimum: 1, maximum: 6 },
    description: { type: "string", description: d("attributes.description") },
    passiveEffect: { type: "string", description: d("attributes.passiveEffect") },
    activeEffect: { type: "string", description: d("attributes.activeEffect") },
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
  return { type: "object", additionalProperties: false, properties: props, required: ["typeName", "element", "rarity"] };
}
export const ATTRIBUTES_SCHEMA = buildAttributesSchema();

// Coerce arbitrary Stage-1 output into a guaranteed-valid Idea (same defensive
// style as normalizeGeneratedMonster — the live LLM stage validates via structured
// output, but we never trust raw model JSON downstream).
export function coerceIdea(raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  // `inspiration` is the spec's 2-4 word characterization; accept a legacy `theme` as a
  // fallback so older overrides/tests still resolve to a usable concept.
  const inspiration = str(r.inspiration, str(r.theme, "a wild cave creature")).slice(0, 120);
  return {
    inspiration,
    theme: inspiration, // kept for the downstream prompts that reference {theme}
    vibe: str(r.vibe, "menacing and territorial").slice(0, 120),
    role: str(r.role, "bruiser").slice(0, 40),
    elementHint: str(r.elementHint, "").slice(0, 24),
    rarityHint: Math.round(num(r.rarityHint, 2, 1, 5)),
  };
}

// ── Stage 3 (Model) structured-output contract ─────────────────────────────
// The Model / visual-BUILDER agent designs the creature's procedural visual + a SMALL FIXED
// set of animations (idle, attack — per spec). `bodyShape` picks one of the renderer's
// silhouette archetypes (spritegen rigs) and `features` picks from the renderer's drawable
// feature vocabulary, so the builder can only spec what spritegen can actually realize. Both
// enums come from the shared src/systems/monsterModel.js (single source of truth).
export { BODY_SHAPES }; // re-export so existing importers (schema/tests) keep working

export function buildModelSchema(d = defaultDesc) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      bodyShape: { type: "string", enum: BODY_SHAPES, description: d("model.bodyShape") },
      palette: {
        type: "object", additionalProperties: false,
        properties: {
          primary: { type: "string", description: d("model.palettePrimary") },
          secondary: { type: "string" },
          accent: { type: "string" },
        },
      },
      features: { type: "array", maxItems: 4, items: { type: "string", enum: FEATURE_VOCAB }, description: d("model.features") },
      animations: {
        type: "object", additionalProperties: false,
        properties: {
          idle: { type: "object", properties: { bob: { type: "number", minimum: 0, maximum: 1 }, speed: { type: "number", minimum: 0.5, maximum: 3 } } },
          attack: { type: "object", properties: { lunge: { type: "number", minimum: 0, maximum: 1 }, speed: { type: "number", minimum: 0.5, maximum: 3 } } },
        },
      },
    },
    required: ["bodyShape"],
  };
}
export const MODEL_SCHEMA = buildModelSchema();

// Arbitrary Stage-3 output → a guaranteed-valid model spec. `bodyShape` snaps to a
// known archetype (invalid → "beast"); palette strings are renderer hints (empty =
// fall back to the element palette); animation params clamp to safe ranges so a
// bad value can't make a creature vibrate or freeze.
export function coerceModel(raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const pal = r.palette && typeof r.palette === "object" ? r.palette : {};
  const anim = r.animations && typeof r.animations === "object" ? r.animations : {};
  const idle = anim.idle && typeof anim.idle === "object" ? anim.idle : {};
  const atk = anim.attack && typeof anim.attack === "object" ? anim.attack : {};
  return {
    bodyShape: BODY_SHAPES.includes(r.bodyShape) ? r.bodyShape : "beast",
    palette: {
      primary: str(pal.primary, "").slice(0, 24),
      secondary: str(pal.secondary, "").slice(0, 24),
      accent: str(pal.accent, "").slice(0, 24),
    },
    // Canonicalize to the renderer's drawable feature keys (drops anything spritegen can't
    // draw, de-dupes, caps at 4) so monster.model.features is always render-ready.
    features: canonicalFeatures(r.features),
    animations: {
      idle: { bob: num(idle.bob, 0.3, 0, 1), speed: num(idle.speed, 1, 0.5, 3) },
      attack: { lunge: num(atk.lunge, 0.6, 0, 1), speed: num(atk.speed, 1.4, 0.5, 3) },
    },
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
    let monster = normalizeGeneratedMonster(attrRaw, opts);
    assignAttacks(monster, opts.attackPool || getAttacks(), opts.rand || Math.random);
    // Stage 3 (optional) — the Model agent designs the procedural visual + idle/attack
    // animations, attached as monster.model for the renderer. The pipeline still
    // succeeds without it (deterministic spritegen stays the fallback), so existing
    // {idea, attributes}-only callers are unaffected.
    let model = null;
    if (typeof stages.model === "function") {
      model = coerceModel(await stages.model({ idea, monster }, opts));
      monster.model = model;
    }
    return { monster, idea, model };
  } catch (e) {
    console.error("[genPipeline] generation failed:", e.message);
    return null;
  }
}
