import { aiEnabled, sanitizePromptText } from "./ai.js";
import { clampText, fillSlot } from "./text.js";
import { getPrompt } from "./prompts.js";
import { getAiConfig } from "./aiconfig.js";
import { chatJson as llmChatJson } from "./llm.js";
import { tracedChatJson } from "./genTrace.js";
import { itemHtmlBrief } from "../src/systems/itemModel.js";
import { coerceHtmlModel } from "../src/systems/htmlModel.js";
import { describeFields } from "./schemaDesc.js";

function str(v, def) { return typeof v === "string" && v.trim() ? v.trim() : def; }

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
    description: clampText(str(r.description, str(r.action, str(r.effect, `A mysterious ${name}.`))), 240),
  };
  const html = coerceHtmlModel({ base: str(r.html, str(r.base, "")) });
  if (html) out.html = html;
  return out;
}

export function buildItemInspirationPrompt(kind = "") {
  return {
    system: getPrompt("itemIdeaSystem"),
    user: fillSlot(getPrompt("itemIdeaUser"), "{kind}", kind ? sanitizePromptText(String(kind), 120) : "", "Make this kind of item"),
  };
}

export function buildItemDesignerPrompt(inspiration) {
  const base = fillSlot(getPrompt("itemDesignerUser"), "{inspiration}", sanitizePromptText(String(inspiration || ""), 80), "Inspiration");
  const guidance = describeFields([["name", "item.name"], ["description", "item.description"]]);
  return {
    system: getPrompt("itemDesignerSystem"),
    user: [base, guidance].filter(Boolean).join("\n\n"),
  };
}

export function buildItemBuilderPrompt(item = {}) {
  const summary = { name: item.name, description: item.description };
  const user = fillSlot(getPrompt("itemBuilderUser"), "{item}", sanitizePromptText(JSON.stringify(summary), 300), "Item");
  return { system: getPrompt("itemBuilderSystem") + "\n\n" + itemHtmlBrief(), user };
}

function chatJson(system, user, model, temperature) {
  return llmChatJson({ model, system, user, temperature });
}

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
