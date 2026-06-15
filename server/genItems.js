// AI item generation (plan "Decide general items"). Items are deliberately SIMPLE: a name +
// a short ACTION description. They are AI-generated the same way as monsters - an inspiration
// agent gives 2-4 words "to characterize the item", then a designer turns that into the item.
// Their behaviour in a fight is judged like an attack (the action description is the instruction
// to the fight-judge), so an item carries no numeric fields.
//
// Framework-agnostic core (normalize + prompt builders), unit-tested without a live API.
// Live generation is gated by aiEnabled(); prompts/model are admin-editable (prompts.js/aiconfig.js).

import { aiEnabled, sanitizePromptText } from "./ai.js";
import { clampText, fillSlot } from "./text.js";
import { getPrompt } from "./prompts.js";
import { getAiConfig } from "./aiconfig.js";
import { openaiChatJson } from "./openai.js"; // model-compatible chat call
import { coerceItemVisual, itemVisualBrief } from "../src/systems/itemModel.js"; // TQ-374: item icon visual builder

function str(v, def) { return typeof v === "string" && v.trim() ? v.trim() : def; }

/**
 * Arbitrary/partial LLM JSON -> a guaranteed-valid simple item { id, name, description }.
 * `description` is the short ACTION text (player-readable AND a fight-judge instruction).
 * Name is made unique vs opts.existingNames (same defense as the monster normalizer).
 */
export function normalizeGeneratedItem(raw = {}, opts = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  let name = str(r.name, "").slice(0, 40);
  if (!name) name = "Curio";
  const existing = opts.existingNames;
  if (existing && typeof existing.has === "function" && existing.has(name)) {
    let i = 2;
    while (existing.has(`${name} ${i}`)) i++;
    name = `${name} ${i}`;
  }
  const out = {
    id: opts.id ?? null,
    name,
    // Accept a few common field names the model might use for the action text.
    description: clampText(str(r.description, str(r.action, str(r.effect, `A mysterious ${name}.`))), 240),
  };
  // TQ-374: attach the authored ICON visual (safe shape-layer paint spec) when the designer provided one.
  const visual = coerceItemVisual(r.visual);
  if (visual) out.visual = visual;
  return out;
}

// Stage 1 - inspiration: 2-4 words to characterize the item (mirrors the monster pipeline).
// `kind` steers the item toward a role (heal / buff / damage / debuff …) so a batch is a varied,
// USEFUL toolkit instead of all enemy-debuffs; fillSlot keeps it working if the prompt is overridden.
export function buildItemInspirationPrompt(kind = "") {
  return {
    system: getPrompt("itemIdeaSystem"),
    user: fillSlot(getPrompt("itemIdeaUser"), "{kind}", kind ? sanitizePromptText(String(kind), 120) : "", "Make this kind of item"),
  };
}

// Stage 2 - designer: receives the inspiration in its user prompt, returns { name, description }.
// fillSlot keeps the inspiration reaching the designer even if an admin override of
// itemDesignerUser drops the {inspiration} placeholder (else items would lose their concept).
export function buildItemDesignerPrompt(inspiration) {
  return {
    system: getPrompt("itemDesignerSystem"),
    // TQ-374: append the icon-visual brief so the designer also authors a `visual` (robust to an admin
    // override that drops it; the coercer re-enforces the allow-list regardless).
    user: fillSlot(getPrompt("itemDesignerUser"), "{inspiration}", sanitizePromptText(String(inspiration || ""), 80), "Inspiration") + "\n\n" + itemVisualBrief(),
  };
}

// One item-phase call with that phase's own model + temperature. Shared openaiChatJson handles
// the current-model param drift (max_completion_tokens + sampling retry).
function chatJson(system, user, model, temperature) {
  return openaiChatJson({ model, system, user, temperature });
}

/**
 * Generate one item through the inspiration->designer pipeline (each phase its own model +
 * temperature). Returns a normalized item or null when AI is disabled / any stage fails.
 * `deps.chat` overrides the LLM call for tests.
 */
export async function aiGenerateItem(opts = {}, deps = {}) {
  if (!aiEnabled()) return null;
  const chat = deps.chat || chatJson;
  try {
    const insp = buildItemInspirationPrompt(opts.kind);
    const ideaRaw = await chat(insp.system, insp.user, getAiConfig("itemInspirationModel"), getAiConfig("itemInspirationTemperature"));
    const inspiration = str(ideaRaw && ideaRaw.inspiration, str(ideaRaw && ideaRaw.words, "a curious trinket"));
    const des = buildItemDesignerPrompt(inspiration);
    const raw = await chat(des.system, des.user, getAiConfig("itemDesignerModel"), getAiConfig("itemDesignerTemperature"));
    return normalizeGeneratedItem(raw, opts);
  } catch (e) {
    console.error("[genItems] item generation failed:", e.message);
    return null;
  }
}
