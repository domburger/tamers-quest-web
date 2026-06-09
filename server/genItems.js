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
  return {
    id: opts.id ?? null,
    name,
    // Accept a few common field names the model might use for the action text.
    description: clampText(str(r.description, str(r.action, str(r.effect, `A mysterious ${name}.`))), 240),
  };
}

// Stage 1 - inspiration: 2-4 words to characterize the item (mirrors the monster pipeline).
export function buildItemInspirationPrompt() {
  return { system: getPrompt("itemIdeaSystem"), user: getPrompt("itemIdeaUser") };
}

// Stage 2 - designer: receives the inspiration in its user prompt, returns { name, description }.
// fillSlot keeps the inspiration reaching the designer even if an admin override of
// itemDesignerUser drops the {inspiration} placeholder (else items would lose their concept).
export function buildItemDesignerPrompt(inspiration) {
  return {
    system: getPrompt("itemDesignerSystem"),
    user: fillSlot(getPrompt("itemDesignerUser"), "{inspiration}", sanitizePromptText(String(inspiration || ""), 80), "Inspiration"),
  };
}

function chatJson(system, user) {
  // Shared helper handles the current-model param drift (max_completion_tokens + sampling retry).
  return openaiChatJson({ model: getAiConfig("model"), system, user, temperature: getAiConfig("genTemperature") });
}

/**
 * Generate one item through the inspiration->designer pipeline. Returns a normalized item or
 * null when AI is disabled / any stage fails. `deps.chat` overrides the LLM call for tests.
 */
export async function aiGenerateItem(opts = {}, deps = {}) {
  if (!aiEnabled()) return null;
  const chat = deps.chat || chatJson;
  try {
    const insp = buildItemInspirationPrompt();
    const ideaRaw = await chat(insp.system, insp.user);
    const inspiration = str(ideaRaw && ideaRaw.inspiration, str(ideaRaw && ideaRaw.words, "a curious trinket"));
    const des = buildItemDesignerPrompt(inspiration);
    const raw = await chat(des.system, des.user);
    return normalizeGeneratedItem(raw, opts);
  } catch (e) {
    console.error("[genItems] item generation failed:", e.message);
    return null;
  }
}
