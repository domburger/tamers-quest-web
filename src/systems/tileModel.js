// Tile VISUAL-BUILDER contract (TQ-359). Unlike monsters (free-form HTML/CSS rendered as a live-DOM
// node), a floor tile is BAKED into a small repeating canvas TEXTURE drawn cheaply per cell
// (src/render/tiles.js generateTileTexture) — a live-DOM node per cell would be catastrophic for perf.
// So the tile builder authors a TILE-APPROPRIATE structured "visual": an ordered list of presentational
// paint LAYERS the renderer composites with canvas2D. Safe BY CONSTRUCTION (structured + allow-listed +
// clamped — there is no markup to inject, so no HTML sanitizer is needed), DETERMINISTIC (placement is
// seeded per tile id, so the texture is stable), and bakeable SYNCHRONOUSLY into the texture. The tile
// DESIGNER stage authors `visual`; coerceTileVisual validates it; tiles.js paints it. Framework-agnostic
// (no DOM) so both the server (genTiles.js) and the client renderer import it.

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
