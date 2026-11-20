import { aiEnabled, sanitizePromptText } from "./ai.js";
import { clampText, fillSlot } from "./text.js";
import { getPrompt } from "./prompts.js";
import { getAiConfig } from "./aiconfig.js";
import { chatJson as llmChatJson } from "./llm.js";
import { tracedChatJson } from "./genTrace.js";
import { tileHtmlBrief } from "../src/systems/tileModel.js";
import { coerceHtmlModel } from "../src/systems/htmlModel.js";
import { describeFields } from "./schemaDesc.js";

function str(v, def) { return typeof v === "string" && v.trim() ? v.trim() : def; }
const clampNum = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
const clampInt = (v, lo, hi, def) => Math.round(clampNum(v, lo, hi, def));
const bit = (v, def = 0) => (v === 1 || v === true || v === "1" || v === "true") ? 1 : (v === 0 || v === false || v === "0" || v === "false") ? 0 : def;
const collFlag = (v) => (v == null || v === "") ? null : bit(v);
export function collidabilityNote(collidable) {
  const c = collFlag(collidable);
  if (c == null) return "";
  return c
    ? "REQUIRED: this ground is COLLIDABLE — an IMPASSABLE boundary the player CANNOT walk through (e.g. deep water, molten lava, a sheer rock wall, a bottomless chasm, jagged spires). Make the name, colour and texture read clearly as a solid/impassable barrier; set collidable = 1."
    : "REQUIRED: this ground is NON-COLLIDABLE — a WALKABLE floor surface the player CAN cross (a normal traversable ground type, not a wall/water/lava). Make the name, colour and texture read as open walkable ground; set collidable = 0.";
}

function rgb(raw, def) {
  if (Array.isArray(raw)) return [clampInt(raw[0], 0, 255, def[0]), clampInt(raw[1], 0, 255, def[1]), clampInt(raw[2], 0, 255, def[2])];
  const c = raw && typeof raw === "object" ? raw : {};
  return [clampInt(c.r ?? c.red, 0, 255, def[0]), clampInt(c.g ?? c.green, 0, 255, def[1]), clampInt(c.b ?? c.blue, 0, 255, def[2])];
}

export function normalizeGeneratedTile(raw = {}, opts = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  let name = str(r.name, "").slice(0, 40) || "Cracked Ground";
  const existing = opts.existingNames;
  if (existing && typeof existing.has === "function" && existing.has(name)) {
    let i = 2;
    while (existing.has(`${name} ${i}`)) i++;
    name = `${name} ${i}`;
  }
  const [fr, fg, fb] = rgb(r.color ?? r.colour ?? r.fill, [96, 96, 102]);
  const biome = str(opts.biome, str(r.biome, "Wilds")).slice(0, 40);
  const tile = {
    id: opts.id ?? null,
    name,
    description: clampText(str(r.description, `${name} underfoot.`), 200),
    rarity: clampInt(r.rarity, 1, 100, 40),
    slipperiness: getAiConfig("tileSlipperinessEnabled") ? clampInt(r.slipperiness, 0, 10, 0) : 0,
    biome,
    speedModifier: getAiConfig("tileSpeedModifierEnabled") ? clampNum(r.speedModifier, 0.5, 2, 1) : 1,
    collidable: collFlag(opts.collidable) != null ? collFlag(opts.collidable) : 0,
    emissiveness: getAiConfig("tileEmissivenessEnabled") ? clampInt(r.emissiveness, 0, 5, 0) : 0,
    generated: true,
    colorProfile_full_r: fr, colorProfile_full_g: fg, colorProfile_full_b: fb,
  };
  const html = coerceHtmlModel({ base: str(r.html, str(r.base, "")) });
  if (html) tile.html = html;
  return tile;
}

export function buildTileInspirationPrompt(biome = "", kind = "", collidable = null) {
  let user = fillSlot(getPrompt("tileIdeaUser"), "{biome}", biome ? sanitizePromptText(String(biome), 40) : "the caves", "Biome");
  user = fillSlot(user, "{kind}", kind ? sanitizePromptText(String(kind), 120) : "", "Make this kind of ground");
  user = fillSlot(user, "{collidable}", collidabilityNote(collidable), "Collidability");
  return { system: getPrompt("tileIdeaSystem"), user };
}

export function buildTileDesignerPrompt(inspiration, biome = "", collidable = null) {
  let user = fillSlot(getPrompt("tileDesignerUser"), "{inspiration}", sanitizePromptText(String(inspiration || ""), 80), "Inspiration");
  user = fillSlot(user, "{biome}", biome ? sanitizePromptText(String(biome), 40) : "", "Biome");
  const guidance = describeFields([["name", "tile.name"], ["description", "tile.description"], ["color", "tile.color"], ["rarity", "tile.rarity"], ["slipperiness", "tile.slipperiness"], ["emissiveness", "tile.emissiveness"]]);
  if (guidance) user += "\n\n" + guidance;
  user = fillSlot(user, "{collidable}", collidabilityNote(collidable), "Collidability");
  return { system: getPrompt("tileDesignerSystem"), user };
}

export function buildTileBuilderPrompt(tile = {}) {
  const summary = {
    name: tile.name, description: tile.description, biome: tile.biome,
    color: { r: tile.colorProfile_full_r, g: tile.colorProfile_full_g, b: tile.colorProfile_full_b },
    collidable: tile.collidable,
  };
  let user = fillSlot(getPrompt("tileBuilderUser"), "{tile}", sanitizePromptText(JSON.stringify(summary), 300), "Tile");
  user = fillSlot(user, "{collidable}", collidabilityNote(tile.collidable), "Collidability");
  return { system: getPrompt("tileBuilderSystem") + "\n\n" + tileHtmlBrief(), user };
}

function chatJson(system, user, model, temperature) {
  return llmChatJson({ model, system, user, temperature });
}

export async function aiGenerateTile(opts = {}, deps = {}) {
  if (!aiEnabled()) return null;
  const chat = deps.chat || chatJson;
  try {
    const insp = buildTileInspirationPrompt(opts.biome, opts.kind, opts.collidable);
    const ideaRaw = await tracedChatJson(chat, { stage: "TileInspiration", system: insp.system, user: insp.user, model: getAiConfig("tileInspirationModel"), temperature: getAiConfig("tileInspirationTemperature") });
    const inspiration = str(ideaRaw && ideaRaw.inspiration, str(ideaRaw && ideaRaw.words, "rough cave floor"));
    const des = buildTileDesignerPrompt(inspiration, opts.biome, opts.collidable);
    const raw = await tracedChatJson(chat, { stage: "TileDesigner", system: des.system, user: des.user, model: getAiConfig("tileDesignerModel"), temperature: getAiConfig("tileDesignerTemperature") });
    const tile = normalizeGeneratedTile(raw, opts);
    if (getAiConfig("tileBuilderEnabled")) {
      const bld = buildTileBuilderPrompt(tile);
      const vraw = await tracedChatJson(chat, { stage: "TileBuilder", system: bld.system, user: bld.user, model: getAiConfig("tileBuilderModel"), temperature: getAiConfig("tileBuilderTemperature") }).catch(() => null);
      const html = coerceHtmlModel({ base: str(vraw && (vraw.html ?? vraw.base), "") });
      if (html) tile.html = html;
    }
    return tile;
  } catch (e) {
    console.error("[genTiles] tile generation failed:", e.message);
    return null;
  }
}
