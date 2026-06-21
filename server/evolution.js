// TQ-551 (TQ-256): AI EVOLUTION core (PURE). Per Dominik's decision (TQ-549, 2026-06-21): at FIXED levels a
// GPT-5.5 agent EDITS the EXISTING monster in place — mutating both its attributes (stats) and its HTML/CSS
// character model (monster.html per-state markup) — using a REPLACE tool (find-and-replace edits), NOT a
// from-scratch regeneration, so the evolved form reads as a grown-up version of the same creature.
//
// This module is the testable CORE: the fixed-level trigger, the replace-tool application (strict
// exactly-once find/replace, like the Edit tool — so the AI can't make ambiguous/garbage mutations), bounded
// attribute edits, ATOMIC in-place application (validate everything before mutating → never a half-evolved
// monster), and idempotency. The live GPT-5.5 stage (the AI call that PRODUCES these edits), the level-up
// hook, and the client "evolved!" moment build on these primitives (follow-on increments of TQ-551).

import { HTML_STATES, isRenderableHtml } from "../src/systems/htmlModel.js";

// The monster evolves ONCE on reaching each of these levels (Dominik: fixed levels). Tune here.
export const EVOLUTION_LEVELS = [15, 30];
// A single evolution may at most DOUBLE any attribute (anti-absurd-jump clamp; the AI proposes, we bound).
export const EVOLUTION_MAX_GROWTH = 2.0;

/**
 * The fixed evolution level a monster crosses going `prevLevel` → `newLevel` that it hasn't evolved at yet,
 * or null. Idempotent via `monster.evolvedLevels` (so a re-applied level-up can't double-evolve). Pure.
 * @returns {number|null}
 */
export function pendingEvolution(monster, newLevel, prevLevel) {
  const lvl = Math.floor(Number(newLevel) || 0);
  const from = Number.isFinite(prevLevel) ? Math.floor(prevLevel) : lvl - 1;
  const done = (monster && monster.evolvedLevels) || [];
  for (const L of EVOLUTION_LEVELS) if (L > from && L <= lvl && !done.includes(L)) return L;
  return null;
}

/**
 * Apply find-and-replace edits to a markup string. Each edit's `oldString` must appear EXACTLY ONCE (the
 * Edit-tool contract) — 0 matches → not_found, >1 → ambiguous — so a vague edit can't silently corrupt the
 * model. Pure; returns the new text without mutating the input. {ok:true,text} | {ok:false,error}.
 */
export function applyReplaceEdits(text, edits) {
  if (typeof text !== "string") return { ok: false, error: "no_text" };
  if (!Array.isArray(edits) || edits.length === 0) return { ok: false, error: "no_edits" };
  let out = text;
  for (const e of edits) {
    if (!e || typeof e.oldString !== "string" || typeof e.newString !== "string") return { ok: false, error: "bad_edit" };
    if (e.oldString === "") return { ok: false, error: "empty_old" };
    const count = out.split(e.oldString).length - 1;
    if (count === 0) return { ok: false, error: "not_found" };
    if (count > 1) return { ok: false, error: "ambiguous" };
    out = out.split(e.oldString).join(e.newString);
  }
  return { ok: true, text: out };
}

/**
 * Apply bounded attribute edits. Each entry is the NEW absolute value for that stat, clamped to
 * [0, max(prev, prev×growth)] so an evolution can grow a stat but not balloon it (growth=2 → at most double;
 * a previously-0 stat may be set to the proposed value). Unknown/non-finite values are ignored. Pure — returns
 * a fresh attrs object. attrEdits is optional (a model-only evolution is allowed).
 */
export function applyAttrEdits(attrs, attrEdits, { maxGrowth = EVOLUTION_MAX_GROWTH } = {}) {
  const out = { ...(attrs || {}) };
  if (!attrEdits || typeof attrEdits !== "object") return out;
  for (const [k, v] of Object.entries(attrEdits)) {
    const next = Number(v);
    if (!Number.isFinite(next)) continue;
    const base = Number(out[k]) || 0;
    const ceil = base > 0 ? Math.round(base * maxGrowth) : Math.round(next);
    out[k] = Math.max(0, Math.min(Math.round(next), Math.max(base, ceil)));
  }
  return out;
}

/**
 * JSON schema for the GPT-5.5 evolution agent's output, shaped for OpenAI STRICT structured output (no
 * open-ended maps — attribute + per-state edits are ARRAYS so every object has fixed, required keys).
 * `normalizeEvolutionResult` converts this wire shape into the {name, attrEdits:{}, modelEdits:{}} that
 * applyEvolution consumes.
 */
export function buildEvolutionSchema() {
  const edit = { type: "object", properties: { oldString: { type: "string", description: "text copied VERBATIM from the current state markup; must occur exactly once" }, newString: { type: "string", description: "its replacement (grows/intensifies that part)" } }, required: ["oldString", "newString"], additionalProperties: false };
  return {
    type: "object",
    properties: {
      name: { type: "string", description: "the evolved monster's new name" },
      attrEdits: { type: "array", description: "new ABSOLUTE stat values (grown, not absurd)", items: { type: "object", properties: { stat: { type: "string" }, value: { type: "number" } }, required: ["stat", "value"], additionalProperties: false } },
      modelEdits: { type: "array", description: "per-state find/replace edits; MUST include the base state", items: { type: "object", properties: { state: { type: "string", enum: HTML_STATES }, edits: { type: "array", items: edit } }, required: ["state", "edits"], additionalProperties: false } },
    },
    required: ["name", "attrEdits", "modelEdits"],
    additionalProperties: false,
  };
}

/** Convert the agent's array-shaped output into the {name, attrEdits:{}, modelEdits:{}} shape applyEvolution wants. Pure; tolerant of junk. */
export function normalizeEvolutionResult(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = { attrEdits: {}, modelEdits: {} };
  if (typeof raw.name === "string" && raw.name.trim()) out.name = raw.name.trim();
  for (const e of (Array.isArray(raw.attrEdits) ? raw.attrEdits : [])) {
    if (e && typeof e.stat === "string" && Number.isFinite(Number(e.value))) out.attrEdits[e.stat] = Number(e.value);
  }
  for (const m of (Array.isArray(raw.modelEdits) ? raw.modelEdits : [])) {
    if (m && typeof m.state === "string" && Array.isArray(m.edits)) out.modelEdits[m.state] = m.edits;
  }
  return out;
}

/**
 * Apply a full evolution (the agent's result) to `monster` IN PLACE and ATOMICALLY. The result is the
 * replace-tool output:
 *   { name?: string, attrEdits?: {stat:number}, modelEdits: { base:[{oldString,newString}], idle?:[...], ... } }
 * Every state's edits must apply cleanly AND leave renderable markup, and `base` MUST be edited (the look has
 * to actually change) — otherwise the whole evolution is rejected with NO partial mutation. On success the
 * monster's html/attributes/name are updated and the level is recorded (idempotency). {ok:true,monster} |
 * {ok:false,error}.
 */
export function applyEvolution(monster, level, result, { maxGrowth = EVOLUTION_MAX_GROWTH } = {}) {
  if (!monster || typeof monster !== "object") return { ok: false, error: "no_monster" };
  if (!result || typeof result !== "object") return { ok: false, error: "no_result" };
  const model = monster.html;
  if (!model || typeof model.base !== "string") return { ok: false, error: "no_model" };
  const modelEdits = result.modelEdits || {};
  if (!Array.isArray(modelEdits.base) || modelEdits.base.length === 0) return { ok: false, error: "base_unedited" };
  // Build the new model first; commit only once EVERY state validates (atomic — never half-evolved).
  const newModel = { ...model };
  for (const state of HTML_STATES) {
    const edits = modelEdits[state];
    if (!edits) continue;
    if (typeof model[state] !== "string") return { ok: false, error: `model_${state}_absent` };
    const res = applyReplaceEdits(model[state], edits);
    if (!res.ok) return { ok: false, error: `model_${state}_${res.error}` };
    if (!isRenderableHtml(res.text)) return { ok: false, error: `model_${state}_unrenderable` };
    newModel[state] = res.text;
  }
  const newAttrs = applyAttrEdits(monster.attributes, result.attrEdits, { maxGrowth });
  // Commit (all validated above → no partial state possible).
  monster.html = newModel;
  monster.attributes = newAttrs;
  if (typeof result.name === "string" && result.name.trim()) monster.name = result.name.trim();
  monster.evolvedLevels = [...((monster.evolvedLevels) || []), level];
  return { ok: true, monster };
}
