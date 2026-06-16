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
import { tracedChatJson } from "./genTrace.js"; // TQ-404: record each stage's prompts/output into the admin gen-trace
import { tileHtmlBrief } from "../src/systems/tileModel.js"; // TQ-393: free HTML/CSS tile-texture builder (replaces the shape-layer visual)
import { coerceHtmlModel } from "../src/systems/htmlModel.js"; // TQ-393: shared monster/item/tile HTML model (coerce → {canvas, base})
import { describeFields } from "./schemaDesc.js"; // TQ-377: admin-tunable per-field guidance

function str(v, def) { return typeof v === "string" && v.trim() ? v.trim() : def; }
const clampNum = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
const clampInt = (v, lo, hi, def) => Math.round(clampNum(v, lo, hi, def));
const bit = (v, def = 0) => (v === 1 || v === true || v === "1" || v === "true") ? 1 : (v === 0 || v === false || v === "0" || v === "false") ? 0 : def;
// A DESIRED collidability input coerced to 0|1|null (null = unspecified → the model decides, as before).
const collFlag = (v) => (v == null || v === "") ? null : bit(v);
// The collidability DIRECTIVE injected into every tile-gen stage (inspiration → designer → builder) so
// the whole pipeline commits to a solid boundary vs a walkable floor when collidability is requested.
// Empty string when unspecified (back-compat: the designer chooses). Safety/role steering only — the
// final tile.collidable is FORCED to the requested value in normalizeGeneratedTile regardless.
export function collidabilityNote(collidable) {
  const c = collFlag(collidable);
  if (c == null) return "";
  return c
    ? "REQUIRED: this ground is COLLIDABLE — an IMPASSABLE boundary the player CANNOT walk through (e.g. deep water, molten lava, a sheer rock wall, a bottomless chasm, jagged spires). Make the name, colour and texture read clearly as a solid/impassable barrier; set collidable = 1."
    : "REQUIRED: this ground is NON-COLLIDABLE — a WALKABLE floor surface the player CAN cross (a normal traversable ground type, not a wall/water/lava). Make the name, colour and texture read as open walkable ground; set collidable = 0.";
}

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
    // TQ-361: per-tile modifiers are gated by admin toggles (default: slipperiness + speed OFF,
    // emissiveness ON). When a toggle is OFF the field is forced to its inert default, so the
    // modifier stays disabled at the data source (the slipperiness/speed EFFECTS are also not
    // applied in movement — removed 2026-06-09 — so this keeps the data consistent with that).
    slipperiness: getAiConfig("tileSlipperinessEnabled") ? clampInt(r.slipperiness, 0, 10, 0) : 0,
    biome,
    speedModifier: getAiConfig("tileSpeedModifierEnabled") ? clampNum(r.speedModifier, 0.5, 2, 1) : 1,
    // 1 = impassable (rendered as a boundary, like water). A requested `opts.collidable` is AUTHORITATIVE
    // (forces the value so a caller can reliably ask for a collidable / walkable tile); otherwise the
    // designer's choice is used. This is what guarantees the per-biome collidable/walkable split.
    collidable: collFlag(opts.collidable) != null ? collFlag(opts.collidable) : bit(r.collidable, 0),
    emissiveness: getAiConfig("tileEmissivenessEnabled") ? clampInt(r.emissiveness, 0, 5, 0) : 0,
    generated: true,                   // tag so an admin wipe removes only generated tiles (not the seed)
    colorProfile_full_r: fr, colorProfile_full_g: fg, colorProfile_full_b: fb,
  };
  // TQ-393: the authored ground texture as a free HTML/CSS model ({canvas, base}) — attached by the
  // Builder stage (below). The designer no longer emits a visual; this defensively accepts an `html`/
  // `base` if a model returns one here. Null/absent → the renderer falls back to the procedural grain.
  const html = coerceHtmlModel({ base: str(r.html, str(r.base, "")) });
  if (html) tile.html = html;
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
export function buildTileInspirationPrompt(biome = "", kind = "", collidable = null) {
  let user = fillSlot(getPrompt("tileIdeaUser"), "{biome}", biome ? sanitizePromptText(String(biome), 40) : "the caves", "Biome");
  user = fillSlot(user, "{kind}", kind ? sanitizePromptText(String(kind), 120) : "", "Make this kind of ground");
  const note = collidabilityNote(collidable);
  if (note) user += "\n" + note;
  return { system: getPrompt("tileIdeaSystem"), user };
}

// Stage 2 - designer: receives the inspiration + biome, returns the tile fields (name, description,
// colour, flags). fillSlot keeps the inspiration + biome reaching the designer despite overrides.
export function buildTileDesignerPrompt(inspiration, biome = "", collidable = null) {
  let user = fillSlot(getPrompt("tileDesignerUser"), "{inspiration}", sanitizePromptText(String(inspiration || ""), 80), "Inspiration");
  user = fillSlot(user, "{biome}", biome ? sanitizePromptText(String(biome), 40) : "", "Biome");
  // TQ-377: admin-tunable per-field guidance appended to the designer prompt.
  const guidance = describeFields([["name", "tile.name"], ["description", "tile.description"], ["color", "tile.color"], ["rarity", "tile.rarity"], ["slipperiness", "tile.slipperiness"], ["emissiveness", "tile.emissiveness"], ["collidable", "tile.collidable"], ["edges", "tile.edges"]]);
  if (guidance) user += "\n\n" + guidance;
  const note = collidabilityNote(collidable);
  if (note) user += "\n\n" + note;
  return { system: getPrompt("tileDesignerSystem"), user };
}

// Stage 3 - builder: a SEPARATE visual-builder AGENT (TQ-372; TQ-393 free HTML/CSS). Given the already-
// designed tile, it authors ONLY the ground texture as a free HTML/CSS fragment (`html`). The RENDER-
// TARGET brief (tileHtmlBrief — allowed tags/CSS + the full-bleed-ground spec) is appended programmatically
// so the builder targets exactly what the sanitizer keeps even if the prompt is overridden. Its own
// model/temperature/prompt — admin-configurable, mirroring the monster Builder.
export function buildTileBuilderPrompt(tile = {}) {
  const summary = {
    name: tile.name, description: tile.description, biome: tile.biome,
    color: { r: tile.colorProfile_full_r, g: tile.colorProfile_full_g, b: tile.colorProfile_full_b },
    collidable: tile.collidable, // so the texture matches a solid boundary vs a walkable floor
  };
  const user = fillSlot(getPrompt("tileBuilderUser"), "{tile}", sanitizePromptText(JSON.stringify(summary), 300), "Tile");
  // TQ-393: append the free HTML/CSS RENDER-TARGET brief (was the shape-layer tileVisualBrief).
  return { system: getPrompt("tileBuilderSystem") + "\n\n" + tileHtmlBrief(), user };
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
    const insp = buildTileInspirationPrompt(opts.biome, opts.kind, opts.collidable);
    const ideaRaw = await tracedChatJson(chat, { stage: "TileInspiration", system: insp.system, user: insp.user, model: getAiConfig("tileInspirationModel"), temperature: getAiConfig("tileInspirationTemperature") });
    const inspiration = str(ideaRaw && ideaRaw.inspiration, str(ideaRaw && ideaRaw.words, "rough cave floor"));
    const des = buildTileDesignerPrompt(inspiration, opts.biome, opts.collidable);
    const raw = await tracedChatJson(chat, { stage: "TileDesigner", system: des.system, user: des.user, model: getAiConfig("tileDesignerModel"), temperature: getAiConfig("tileDesignerTemperature") });
    const tile = normalizeGeneratedTile(raw, opts);
    // Stage 3 (TQ-393) — the Builder agent authors the ground texture as free HTML/CSS `html` ({canvas,
    // base}) (its own model/temp/prompt). Gated by tileBuilderEnabled (default on); off → no html →
    // renderer falls back to the procedural grain. A builder failure never fails the tile.
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
