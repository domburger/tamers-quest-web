import { HTML_STATES, isRenderableHtml } from "../src/systems/htmlModel.js";

export const EVOLUTION_LEVELS = [30];
export const EVOLUTION_MAX_GROWTH = 2.0;

export function pendingEvolution(monster, newLevel, prevLevel) {
  const lvl = Math.floor(Number(newLevel) || 0);
  const from = Number.isFinite(prevLevel) ? Math.floor(prevLevel) : lvl - 1;
  const done = (monster && monster.evolvedLevels) || [];
  for (const L of EVOLUTION_LEVELS) if (L > from && L <= lvl && !done.includes(L)) return L;
  return null;
}

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

export const EVOLVE_STAT_KEYS = ["baseHealth", "baseStrength", "baseDefense", "baseSpeed", "basePower", "baseEnergy", "baseLuck"];

export function applyAttrEdits(source, attrEdits, { maxGrowth = EVOLUTION_MAX_GROWTH } = {}) {
  const out = {};
  if (!attrEdits || typeof attrEdits !== "object") return out;
  for (const [k, v] of Object.entries(attrEdits)) {
    const next = Number(v);
    if (!Number.isFinite(next)) continue;
    const base = Number(source && source[k]) || 0;
    const ceil = base > 0 ? Math.round(base * maxGrowth) : Math.round(next);
    out[k] = Math.max(0, Math.min(Math.round(next), Math.max(base, ceil)));
  }
  return out;
}

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

export function applyEvolution(monster, level, result, { maxGrowth = EVOLUTION_MAX_GROWTH } = {}) {
  if (!monster || typeof monster !== "object") return { ok: false, error: "no_monster" };
  if (!result || typeof result !== "object") return { ok: false, error: "no_result" };
  const model = monster.html;
  if (!model || typeof model.base !== "string") return { ok: false, error: "no_model" };
  const modelEdits = result.modelEdits || {};
  if (!Array.isArray(modelEdits.base) || modelEdits.base.length === 0) return { ok: false, error: "base_unedited" };
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
  const statEdits = applyAttrEdits(monster, result.attrEdits, { maxGrowth });
  monster.html = newModel;
  Object.assign(monster, statEdits);
  if (typeof result.name === "string" && result.name.trim()) monster.name = result.name.trim();
  monster.evolvedLevels = [...((monster.evolvedLevels) || []), level];
  return { ok: true, monster };
}

