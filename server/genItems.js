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
import { tracedChatJson } from "./genTrace.js"; // TQ-404: record each stage's prompts/output into the admin gen-trace
import { itemHtmlBrief } from "../src/systems/itemModel.js"; // TQ-393: free HTML/CSS item-icon builder (replaces the shape-layer visual)
import { coerceHtmlModel } from "../src/systems/htmlModel.js"; // TQ-393: shared monster/item/tile HTML model (coerce → {canvas, base})
import { describeFields } from "./schemaDesc.js"; // TQ-377: admin-tunable per-field guidance

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
  // TQ-393: attach the authored ICON as a free HTML/CSS model ({canvas, base}) when the builder provided
  // one. Accept `html` (the builder's field) or a bare `base`. (The legacy shape-layer `visual` builder
  // + renderer were removed with the back-compat path — items render only from `html` now.)
  const html = coerceHtmlModel({ base: str(r.html, str(r.base, "")) });
  if (html) out.html = html;
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
  const base = fillSlot(getPrompt("itemDesignerUser"), "{inspiration}", sanitizePromptText(String(inspiration || ""), 80), "Inspiration");
  // TQ-377: admin-tunable field guidance. (TQ-390: the icon `visual` moved OFF the designer to a
  // dedicated Builder agent — the designer system prompt only emits {name, description}, so appending
  // the visual brief here did nothing; buildItemBuilderPrompt now authors the visual in its own call.)
  const guidance = describeFields([["name", "item.name"], ["description", "item.description"]]);
  return {
    system: getPrompt("itemDesignerSystem"),
    user: [base, guidance].filter(Boolean).join("\n\n"),
  };
}

// Stage 3 - BUILDER (TQ-390; TQ-393 free HTML/CSS): a SEPARATE visual-builder agent. Given the already-
// designed item, it authors ONLY the icon as a free HTML/CSS fragment (`html`). The RENDER-TARGET brief
// (itemHtmlBrief — allowed tags/CSS + the transparent-icon spec) is appended programmatically so the
// builder targets exactly what the sanitizer (htmlSanitize.js) keeps even if the prompt is overridden
// (mirrors the monster Builder / genModelBrief and the tile Builder).
export function buildItemBuilderPrompt(item = {}) {
  const summary = { name: item.name, description: item.description };
  const user = fillSlot(getPrompt("itemBuilderUser"), "{item}", sanitizePromptText(JSON.stringify(summary), 300), "Item");
  // TQ-393: append the free HTML/CSS RENDER-TARGET brief (was the shape-layer itemVisualBrief).
  return { system: getPrompt("itemBuilderSystem") + "\n\n" + itemHtmlBrief(), user };
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
    const ideaRaw = await tracedChatJson(chat, { stage: "ItemInspiration", system: insp.system, user: insp.user, model: getAiConfig("itemInspirationModel"), temperature: getAiConfig("itemInspirationTemperature") });
    const inspiration = str(ideaRaw && ideaRaw.inspiration, str(ideaRaw && ideaRaw.words, "a curious trinket"));
    const des = buildItemDesignerPrompt(inspiration);
    const raw = await tracedChatJson(chat, { stage: "ItemDesigner", system: des.system, user: des.user, model: getAiConfig("itemDesignerModel"), temperature: getAiConfig("itemDesignerTemperature") });
    const item = normalizeGeneratedItem(raw, opts);
    // TQ-393: Stage 3 — the visual-builder agent authors the icon as free HTML/CSS `html` ({canvas, base})
    // (gated by itemBuilderEnabled, default on; off → no html → the icon falls back to the text-only card).
    // A builder failure never fails the item — it just ships without an icon (.catch → null → no html).
    if (item && getAiConfig("itemBuilderEnabled")) {
      const bld = buildItemBuilderPrompt(item);
      const vraw = await tracedChatJson(chat, { stage: "ItemBuilder", system: bld.system, user: bld.user, model: getAiConfig("itemBuilderModel"), temperature: getAiConfig("itemBuilderTemperature") }).catch(() => null);
      const html = coerceHtmlModel({ base: str(vraw && (vraw.html ?? vraw.base), "") });
      if (html) item.html = html;
    }
    return item;
  } catch (e) {
    console.error("[genItems] item generation failed:", e.message);
    return null;
  }
}
