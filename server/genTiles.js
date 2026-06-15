// AI floor-tile generation — mirrors the item pipeline (inspiration -> designer). A floor TILE is
// one ground type within a BIOME: a name, a short flavour description, a representative COLOUR
// (the renderer builds a detailed procedural texture from it — src/render/tiles.js), and a few
// terrain flags. The 4 per-side edge colours that mapgen's seam-matching reads are DERIVED from
// the full colour (so same-type / same-biome tiles tile seamlessly). A generated tile joins the
// live ground-tile pool (engine/gamedata) and is grouped by its `biome` (buildBiomePools).
//
// Framework-agnostic core (normalize + prompt builders), unit-tested without a live API. Live
// generation is gated by aiEnabled(); prompts/model are admin-editable (prompts.js/aiconfig.js).

import { aiEnabled, sanitizePromptText } from "./ai.js";
import { clampText, fillSlot } from "./text.js";
import { getPrompt } from "./prompts.js";
import { getAiConfig } from "./aiconfig.js";
import { openaiChatJson } from "./openai.js"; // model-compatible chat call
import { coerceTileVisual, tileVisualBrief } from "../src/systems/tileModel.js"; // TQ-359: tile visual builder

function str(v, def) { return typeof v === "string" && v.trim() ? v.trim() : def; }
const clampNum = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
const clampInt = (v, lo, hi, def) => Math.round(clampNum(v, lo, hi, def));
const bit = (v, def = 0) => (v === 1 || v === true || v === "1" || v === "true") ? 1 : (v === 0 || v === false || v === "0" || v === "false") ? 0 : def;

// Accept a colour as {r,g,b}, [r,g,b], or {red,green,blue} -> a clamped [r,g,b] triple.
function rgb(raw, def) {
  if (Array.isArray(raw)) return [clampInt(raw[0], 0, 255, def[0]), clampInt(raw[1], 0, 255, def[1]), clampInt(raw[2], 0, 255, def[2])];
  const c = raw && typeof raw === "object" ? raw : {};
  return [clampInt(c.r ?? c.red, 0, 255, def[0]), clampInt(c.g ?? c.green, 0, 255, def[1]), clampInt(c.b ?? c.blue, 0, 255, def[2])];
}

/**
 * Arbitrary/partial LLM JSON -> a guaranteed-valid ground tile with the full colorProfile_* set
 * the engine + renderer read. The model supplies ONE representative colour (+ optional terrain
 * flags); we expand it into the full/top/bottom/left/right profile. Name is made unique vs
 * opts.existingNames. `opts.biome` (the target biome) wins over any biome the model echoes back,
 * so the tile reliably pools under the biome it was generated for.
 */
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
    slipperiness: clampInt(r.slipperiness, 0, 10, 0),
    biome,
    speedModifier: 1,                  // movement speed is uniform (per-tile speed removed 2026-06-09)
    collidable: bit(r.collidable, 0),  // 1 = impassable (rendered as a boundary, like water)
    emissiveness: clampInt(r.emissiveness, 0, 5, 0),
    generated: true,                   // tag so an admin wipe removes only generated tiles (not the seed)
    colorProfile_full_r: fr, colorProfile_full_g: fg, colorProfile_full_b: fb,
  };
  // TQ-359: the designer's authored VISUAL (layered paint spec) — validated + clamped to the
  // allow-list. Null/absent → the renderer falls back to the procedural grain (back-compat).
  const visual = coerceTileVisual(r.visual);
  if (visual) tile.visual = visual;
  // Per-side edge colours drive mapgen's WFC seam-matching. Default each side = the full colour
  // so same-type / same-biome tiles match perfectly (a seamless floor); the renderer adds the
  // grain/detail on top. A model MAY supply distinct edges (e.g. a tile that darkens at one side).
  for (const k of ["top", "bottom", "left", "right"]) {
    const [sr, sg, sb] = rgb(r[k] ?? r[`${k}Color`], [fr, fg, fb]);
    tile[`colorProfile_${k}_r`] = sr;
    tile[`colorProfile_${k}_g`] = sg;
    tile[`colorProfile_${k}_b`] = sb;
  }
  return tile;
}

// Stage 1 - inspiration: 2-4 words to characterize the ground type, steered by its biome (and an
// optional `kind`). fillSlot keeps both reaching the model even if an admin override drops a slot.
export function buildTileInspirationPrompt(biome = "", kind = "") {
  let user = fillSlot(getPrompt("tileIdeaUser"), "{biome}", biome ? sanitizePromptText(String(biome), 40) : "the caves", "Biome");
  user = fillSlot(user, "{kind}", kind ? sanitizePromptText(String(kind), 120) : "", "Make this kind of ground");
  return { system: getPrompt("tileIdeaSystem"), user };
}

// Stage 2 - designer: receives the inspiration + biome, returns the tile fields (name, description,
// colour, flags). fillSlot keeps the inspiration + biome reaching the designer despite overrides.
export function buildTileDesignerPrompt(inspiration, biome = "") {
  let user = fillSlot(getPrompt("tileDesignerUser"), "{inspiration}", sanitizePromptText(String(inspiration || ""), 80), "Inspiration");
  user = fillSlot(user, "{biome}", biome ? sanitizePromptText(String(biome), 40) : "", "Biome");
  // TQ-359: the tile visual-builder brief is appended programmatically (mirrors the monster builder),
  // so the designer always targets the layer schema the coercer accepts even if the prompt is overridden.
  return { system: getPrompt("tileDesignerSystem") + "\n\n" + tileVisualBrief(), user };
}

// One tile-phase call with that phase's own model + temperature (shared openaiChatJson).
function chatJson(system, user, model, temperature) {
  return openaiChatJson({ model, system, user, temperature });
}

/**
 * Generate one floor tile through the inspiration->designer pipeline (each phase its own model +
 * temperature). Returns a normalized tile or null when AI is disabled / any stage fails.
 * `opts.biome` targets the biome the tile belongs to; `deps.chat` overrides the LLM call for tests.
 */
export async function aiGenerateTile(opts = {}, deps = {}) {
  if (!aiEnabled()) return null;
  const chat = deps.chat || chatJson;
  try {
    const insp = buildTileInspirationPrompt(opts.biome, opts.kind);
    const ideaRaw = await chat(insp.system, insp.user, getAiConfig("tileInspirationModel"), getAiConfig("tileInspirationTemperature"));
    const inspiration = str(ideaRaw && ideaRaw.inspiration, str(ideaRaw && ideaRaw.words, "rough cave floor"));
    const des = buildTileDesignerPrompt(inspiration, opts.biome);
    const raw = await chat(des.system, des.user, getAiConfig("tileDesignerModel"), getAiConfig("tileDesignerTemperature"));
    return normalizeGeneratedTile(raw, opts);
  } catch (e) {
    console.error("[genTiles] tile generation failed:", e.message);
    return null;
  }
}
