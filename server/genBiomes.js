import { aiEnabled, sanitizePromptText } from "./ai.js";
import { clampText, fillSlot } from "./text.js";
import { getPrompt } from "./prompts.js";
import { getAiConfig } from "./aiconfig.js";
import { chatJson as llmChatJson } from "./llm.js";
import { tracedChatJson } from "./genTrace.js";
import { describeFields } from "./schemaDesc.js";
import { getGenConfig } from "./genConfig.js";

function str(v, def) { return typeof v === "string" && v.trim() ? v.trim() : def; }
const clampNum = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
const clampInt = (v, lo, hi, def) => Math.round(clampNum(v, lo, hi, def));

function rgb(raw, def) {
  if (Array.isArray(raw)) return [clampInt(raw[0], 0, 255, def[0]), clampInt(raw[1], 0, 255, def[1]), clampInt(raw[2], 0, 255, def[2])];
  const c = raw && typeof raw === "object" ? raw : {};
  return [clampInt(c.r ?? c.red, 0, 255, def[0]), clampInt(c.g ?? c.green, 0, 255, def[1]), clampInt(c.b ?? c.blue, 0, 255, def[2])];
}

export function normalizeGeneratedBiome(raw = {}, opts = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  let name = str(r.name, "").slice(0, 40) || "Wilds";
  const existing = opts.existingNames;
  if (existing && typeof existing.has === "function" && existing.has(name)) {
    let i = 2;
    while (existing.has(`${name} ${i}`)) i++;
    name = `${name} ${i}`;
  }
  const rarity = getGenConfig("biomeRarity") ? clampInt(r.rarity, 1, 100, 50) : 50;
  const size = getGenConfig("biomeSize") ? clampInt(r.size, 30, 120, 60) : 60;
  return {
    name,
    description: clampText(str(r.description, `The ${name}.`), 240),
    rarity,
    size,
    tint: rgb(r.tint ?? r.color ?? r.colour, [120, 120, 128]),
    generated: true,
  };
}

export function buildBiomeInspirationPrompt(kind = "") {
  return {
    system: getPrompt("biomeIdeaSystem"),
    user: fillSlot(getPrompt("biomeIdeaUser"), "{kind}", kind ? sanitizePromptText(String(kind), 120) : "", "Make this kind of place"),
  };
}

export function buildBiomeDesignerPrompt(inspiration) {
  const base = fillSlot(getPrompt("biomeDesignerUser"), "{inspiration}", sanitizePromptText(String(inspiration || ""), 80), "Inspiration");
  const fields = [["name", "biome.name"], ["description", "biome.description"]];
  if (getGenConfig("biomeRarity")) fields.push(["rarity", "biome.rarity"]);
  if (getGenConfig("biomeSize")) fields.push(["size", "biome.size"]);
  fields.push(["tint", "biome.tint"]);
  const guidance = describeFields(fields);
  return {
    system: getPrompt("biomeDesignerSystem"),
    user: [base, guidance].filter(Boolean).join("\n\n"),
  };
}

function chatJson(system, user, model, temperature) {
  return llmChatJson({ model, system, user, temperature });
}

export async function aiGenerateBiome(opts = {}, deps = {}) {
  if (!aiEnabled()) return null;
  const chat = deps.chat || chatJson;
  try {
    const insp = buildBiomeInspirationPrompt(opts.kind);
    const ideaRaw = await tracedChatJson(chat, { stage: "BiomeInspiration", system: insp.system, user: insp.user, model: getAiConfig("biomeInspirationModel"), temperature: getAiConfig("biomeInspirationTemperature") });
    const inspiration = str(ideaRaw && ideaRaw.inspiration, str(ideaRaw && ideaRaw.words, "a strange wilderness"));
    const des = buildBiomeDesignerPrompt(inspiration);
    const raw = await tracedChatJson(chat, { stage: "BiomeDesigner", system: des.system, user: des.user, model: getAiConfig("biomeDesignerModel"), temperature: getAiConfig("biomeDesignerTemperature") });
    return normalizeGeneratedBiome(raw, opts);
  } catch (e) {
    console.error("[genBiomes] biome generation failed:", e.message);
    return null;
  }
}
