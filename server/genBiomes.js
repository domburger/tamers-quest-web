// AI biome generation — mirrors the item pipeline (inspiration -> designer). A BIOME is a
// themed region of the world: a NAME, a representative minimap TINT, plus rarity/size. Biomes
// are PURELY visual/region markers now (movement is the same speed everywhere, 2026-06-09), so a
// biome carries no mechanical fields — just identity + palette. A generated biome AUGMENTS the
// built-in BIOME_DEFS pool that mapgen's Voronoi region assignment picks from, and its `name`
// groups the floor tiles generated for it (see genTiles.js + engine/mapgen.js buildBiomePools).
//
// Framework-agnostic core (normalize + prompt builders), unit-tested without a live API. Live
// generation is gated by aiEnabled(); prompts/model are admin-editable (prompts.js/aiconfig.js).

import { aiEnabled, sanitizePromptText } from "./ai.js";
import { clampText, fillSlot } from "./text.js";
import { getPrompt } from "./prompts.js";
import { getAiConfig } from "./aiconfig.js";
import { openaiChatJson } from "./openai.js"; // model-compatible chat call
import { tracedChatJson } from "./genTrace.js"; // TQ-404: record each stage's prompts/output into the admin gen-trace
import { describeFields } from "./schemaDesc.js"; // TQ-377: admin-tunable per-field guidance

function str(v, def) { return typeof v === "string" && v.trim() ? v.trim() : def; }
const clampNum = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
const clampInt = (v, lo, hi, def) => Math.round(clampNum(v, lo, hi, def));

// Accept a colour as {r,g,b}, [r,g,b], or {red,green,blue} -> a clamped [r,g,b] triple.
function rgb(raw, def) {
  if (Array.isArray(raw)) return [clampInt(raw[0], 0, 255, def[0]), clampInt(raw[1], 0, 255, def[1]), clampInt(raw[2], 0, 255, def[2])];
  const c = raw && typeof raw === "object" ? raw : {};
  return [clampInt(c.r ?? c.red, 0, 255, def[0]), clampInt(c.g ?? c.green, 0, 255, def[1]), clampInt(c.b ?? c.blue, 0, 255, def[2])];
}

/**
 * Arbitrary/partial LLM JSON -> a guaranteed-valid biome { name, description, rarity, size, tint:[r,g,b] }.
 * Name is made unique vs opts.existingNames (same defense as the monster/item normalizers); the
 * caller seeds existingNames with the built-in BIOME_DEFS names so a generated biome never
 * shadows a built-in (which would change how its tiles pool).
 */
export function normalizeGeneratedBiome(raw = {}, opts = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  let name = str(r.name, "").slice(0, 40) || "Wilds";
  const existing = opts.existingNames;
  if (existing && typeof existing.has === "function" && existing.has(name)) {
    let i = 2;
    while (existing.has(`${name} ${i}`)) i++;
    name = `${name} ${i}`;
  }
  return {
    name,
    description: clampText(str(r.description, `The ${name}.`), 240),
    rarity: clampInt(r.rarity, 1, 100, 50),       // matches BIOME_DEFS' 30-90 range
    size: clampInt(r.size, 30, 120, 60),          // legacy field kept for shape compatibility
    tint: rgb(r.tint ?? r.color ?? r.colour, [120, 120, 128]), // representative minimap RGB (required)
    generated: true,                              // tag so an admin wipe removes only generated biomes
  };
}

// Stage 1 - inspiration: 2-4 words to characterize the biome (mirrors the item/monster pipelines).
// `kind` steers the place toward a flavour so a batch is a VARIED set of regions; fillSlot keeps it
// working even if an admin override of biomeIdeaUser drops the {kind} placeholder.
export function buildBiomeInspirationPrompt(kind = "") {
  return {
    system: getPrompt("biomeIdeaSystem"),
    user: fillSlot(getPrompt("biomeIdeaUser"), "{kind}", kind ? sanitizePromptText(String(kind), 120) : "", "Make this kind of place"),
  };
}

// Stage 2 - designer: receives the inspiration, returns { name, description, rarity, size, tint, element }.
// fillSlot keeps the inspiration reaching the designer even if an admin override drops {inspiration}.
export function buildBiomeDesignerPrompt(inspiration) {
  const base = fillSlot(getPrompt("biomeDesignerUser"), "{inspiration}", sanitizePromptText(String(inspiration || ""), 80), "Inspiration");
  // TQ-377: admin-tunable per-field guidance appended to the designer prompt.
  const guidance = describeFields([["name", "biome.name"], ["description", "biome.description"], ["rarity", "biome.rarity"], ["size", "biome.size"], ["tint", "biome.tint"]]);
  return {
    system: getPrompt("biomeDesignerSystem"),
    user: [base, guidance].filter(Boolean).join("\n\n"),
  };
}

// One biome-phase call with that phase's own model + temperature (shared openaiChatJson).
function chatJson(system, user, model, temperature) {
  return openaiChatJson({ model, system, user, temperature });
}

/**
 * Generate one biome through the inspiration->designer pipeline (each phase its own model +
 * temperature). Returns a normalized biome or null when AI is disabled / any stage fails.
 * `deps.chat` overrides the LLM call for tests.
 */
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
