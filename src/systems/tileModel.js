// Tile VISUAL-BUILDER contract.
//
// TQ-393 (Dominik 2026-06-16): the tile builder now authors a FREE-FORM HTML/CSS ground texture, exactly
// like the monster + item visual builders (htmlModel.js + htmlSanitize.js) — no more fixed layer-types +
// large structured JSON. tileHtmlBrief() is the render-target spec; the tile stores `html` ({canvas,
// base}) shaped like monster.html. A floor tile is still BAKED into a small repeating canvas TEXTURE
// drawn cheaply per cell (a live-DOM node per cell would be catastrophic for perf), so the authored HTML
// is rasterized ONCE per tile type to a texture via an SVG-foreignObject raster (src/render/htmlRaster.js)
// — the SAME rest-pose-raster technique the monster/item icon grids use. SECURITY: the markup goes
// through the default-deny sanitizer (htmlSanitize.js) before the raster.
//
// LEGACY (kept for back-compat — tiles generated before TQ-393, + the seed tiles): the original
// structured "visual" = an ordered list of presentational paint LAYERS composited with canvas2D
// (paintVisualLayers in src/render/tiles.js). coerceTileVisual still validates it; tiles.js still paints
// it for tiles that carry a `visual` but no `html`. Framework-agnostic (no DOM) so both the server
// (genTiles.js) and the client renderer import it.

import { HTML_CANVAS, HTML_ALLOWED_TAGS, HTML_ALLOWED_CSS_PROPS, HTML_FORBIDDEN } from "./htmlModel.js"; // TQ-393: free HTML/CSS tile builder (reuse the monster allow-lists/sanitizer)

export const TILE_CANVAS = 64; // matches the TEX size generateTileTexture bakes at
export const TILE_LAYER_TYPES = ["gradient", "speckle", "cracks", "patches", "glints"];
const MAX_LAYERS = 8;

const clampNum = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
const clampInt = (v, lo, hi, def) => Math.round(clampNum(v, lo, hi, def));
function color(raw, def = [120, 120, 128]) {
  const c = Array.isArray(raw) ? { r: raw[0], g: raw[1], b: raw[2] } : (raw && typeof raw === "object" ? raw : {});
  return [clampInt(c.r ?? c.red, 0, 255, def[0]), clampInt(c.g ?? c.green, 0, 255, def[1]), clampInt(c.b ?? c.blue, 0, 255, def[2])];
}

function coerceLayer(l) {
  if (!l || typeof l !== "object") return null;
  const type = String(l.type || "").toLowerCase();
  if (!TILE_LAYER_TYPES.includes(type)) return null;
  const col = color(l.color ?? l.colour ?? l.fill);
  switch (type) {
    case "gradient": {
      let dir = String(l.dir || l.direction || "vertical").toLowerCase();
      if (!["vertical", "horizontal", "radial"].includes(dir)) dir = "vertical";
      return { type, dir, color: col, opacity: clampNum(l.opacity, 0, 0.85, 0.3) };
    }
    case "speckle":
      return { type, color: col, density: clampNum(l.density, 0, 1, 0.3), size: clampInt(l.size, 1, 3, 1), opacity: clampNum(l.opacity, 0, 0.6, 0.35) };
    case "cracks":
      return { type, color: col, count: clampInt(l.count, 0, 48, 6), width: clampInt(l.width, 1, 3, 1), opacity: clampNum(l.opacity, 0, 0.8, 0.4) };
    case "patches":
      return { type, color: col, count: clampInt(l.count, 0, 24, 5), radius: clampInt(l.radius, 2, 22, 8), opacity: clampNum(l.opacity, 0, 0.8, 0.4) };
    case "glints":
      return { type, color: col, count: clampInt(l.count, 0, 80, 16), opacity: clampNum(l.opacity, 0, 0.5, 0.25) };
    default: return null;
  }
}

// Arbitrary/partial builder JSON -> a guaranteed-safe { layers: [...] } (or null when nothing usable).
// Drops unknown layer types, clamps every number/colour, caps the layer count. Accepts either
// { layers: [...] } or a bare array.
export function coerceTileVisual(raw) {
  if (!raw || typeof raw !== "object") return null;
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw.layers) ? raw.layers : null;
  if (!arr) return null;
  const layers = [];
  for (const l of arr) {
    if (layers.length >= MAX_LAYERS) break;
    const c = coerceLayer(l);
    if (c) layers.push(c);
  }
  return layers.length ? { layers } : null;
}

// True when a tile carries an authored visual (≥1 valid layer).
export function hasTileVisual(tile) {
  return !!(tile && tile.visual && Array.isArray(tile.visual.layers) && tile.visual.layers.length);
}

// Builder brief appended to the tile designer prompt so the model authors a `visual` the renderer
// accepts (mirrors htmlModelBrief for monsters). The coercer re-enforces the allow-list regardless.
export function tileVisualBrief() {
  return `VISUAL: also author a "visual" object describing how the ground TEXTURE looks, as an ordered list of paint LAYERS composited over the base colour on a ${TILE_CANVAS}x${TILE_CANVAS}px seamless tile. Shape: {"visual":{"layers":[ ... ]}}. Each layer is exactly one of:
- {"type":"gradient","dir":"vertical|horizontal|radial","color":{"r","g","b"},"opacity":0-0.85} — broad shading.
- {"type":"speckle","color":{...},"density":0-1,"size":1-3,"opacity":0-0.6} — fine mineral grain.
- {"type":"cracks","color":{...},"count":0-48,"width":1-3,"opacity":0-0.8} — fractures/veins.
- {"type":"patches","color":{...},"count":0-24,"radius":2-22,"opacity":0-0.8} — moss/lichen/rock blobs.
- {"type":"glints","color":{...},"count":0-80,"opacity":0-0.5} — sparse bright specks.
Use 2-5 layers that suit the ground type (e.g. cracked stone = a dark gradient + grey speckle + a few cracks; mossy floor = green patches + speckle). Keep it readable from above; never a flat opaque block. Anything outside this schema is dropped.`;
}

// TQ-393: the HTML/CSS render-target brief for the ground-TILE builder — the free-form replacement for
// the layer-spec above. Mirrors htmlModelBrief() (monsters) / itemHtmlBrief() but tuned for a FULL-BLEED,
// seamless-ish, top-down ground texture (NOT a transparent centered icon): the root element DOES paint
// the whole cell. Re-asserts the allow-list/forbidden set so the model targets what the sanitizer keeps.
export function tileHtmlBrief() {
  const G = HTML_CANVAS;
  return `RENDER TARGET — your SOLE TASK is to draw THIS GROUND TILE as a single self-contained HTML+CSS fragment that COMPLETELY FILLS a ${G}x${G}px square (a top-down floor texture, viewed from directly above).
Structure: ONE root <div> sized to the ${G}x${G} box (position:relative; width:100%; height:100%). UNLIKE an icon, the tile MUST cover the whole cell — the root <div> SHOULD paint the base ground (a background color or gradient is REQUIRED; NO transparent gaps, no rounded corners, no border, no drop-shadow that would frame the cell as a card). Build the surface detail from nested <div>/<span> (cracks, veins, speckle, mineral flecks, moss/lichen patches, pebbles) and/or inline ${["svg", "path", "ellipse", "circle", "polygon"].join("/")}, positioned across the WHOLE box.
Keep detail HIGH-FREQUENCY and edge-to-edge so the floor reads as continuous ground and TILES reasonably when repeated across the map — AVOID one big centered motif or a strong single focal point (that would read as an obvious repeating stamp). It must look good as a STILL image (a subtle shimmer/animation via a <style> @keyframes block is OPTIONAL and not required).
Allowed tags ONLY: ${HTML_ALLOWED_TAGS.join(", ")} (<style> for @keyframes only). Style via inline style attributes; allowed CSS includes ${HTML_ALLOWED_CSS_PROPS.slice(0, 12).join(", ")}, … plus transform/filter/box-shadow/border-radius and the animation properties.
FORBIDDEN (the sanitizer STRIPS these — never emit them): ${HTML_FORBIDDEN.join(", ")}, any external/remote reference (url()/href to a URL, @import), and any on* event handler.
Style: match the tile's BIOME and its base COLOUR (use it as the ground tone); a grim, grounded, naturalistic look — never a flat single-colour block, never neon. Keep the fragment reasonably compact.`;
}
