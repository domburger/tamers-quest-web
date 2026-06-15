// Item VISUAL-BUILDER contract (TQ-374). Mirrors the tile visual builder (tileModel.js) but for an
// ITEM ICON rather than a repeating ground texture: the item Designer stage authors a structured
// "visual" = an ordered list of SHAPE layers composited (canvas2D) into a small transparent icon
// (drawItemIcon in src/render/itemIcon.js). Safe BY CONSTRUCTION (structured + allow-listed + clamped —
// no markup to inject, so no sanitizer needed), DETERMINISTIC (no randomness — exact placement), and
// cheap (one small canvas, baked once). Framework-agnostic (no DOM) so both the server (genItems.js)
// and the client renderer import it. Geometry is NORMALIZED to 0..1 of the icon box so it scales to any
// drawn size.
export const ITEM_ICON = 64; // reference icon size the fractions map onto
export const ITEM_LAYER_TYPES = ["disc", "ring", "roundrect", "bar", "diamond", "triangle", "sparkle"];
const MAX_LAYERS = 10;

const clampNum = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
function color(raw, def = [180, 180, 190]) {
  const c = Array.isArray(raw) ? { r: raw[0], g: raw[1], b: raw[2] } : (raw && typeof raw === "object" ? raw : {});
  const ci = (v, d) => Math.round(clampNum(v, 0, 255, d));
  return [ci(c.r ?? c.red, def[0]), ci(c.g ?? c.green, def[1]), ci(c.b ?? c.blue, def[2])];
}
// Common fields every shape carries: a centre (cx,cy) + colour + opacity. Positions/sizes are 0..1.
const base = (l) => ({ cx: clampNum(l.cx ?? l.x, 0, 1, 0.5), cy: clampNum(l.cy ?? l.y, 0, 1, 0.5), color: color(l.color ?? l.colour ?? l.fill), opacity: clampNum(l.opacity, 0, 1, 1) });

function coerceLayer(l) {
  if (!l || typeof l !== "object") return null;
  const type = String(l.type || "").toLowerCase();
  if (!ITEM_LAYER_TYPES.includes(type)) return null;
  const b = base(l);
  switch (type) {
    case "disc":     return { type, ...b, r: clampNum(l.r ?? l.radius, 0.02, 0.5, 0.3) };
    case "ring":     return { type, ...b, r: clampNum(l.r ?? l.radius, 0.02, 0.5, 0.3), width: clampNum(l.width, 0.01, 0.2, 0.06) };
    case "roundrect":return { type, ...b, w: clampNum(l.w, 0.05, 1, 0.5), h: clampNum(l.h, 0.05, 1, 0.5), radius: clampNum(l.radius, 0, 0.5, 0.15) };
    case "bar":      return { type, ...b, w: clampNum(l.w, 0.03, 1, 0.5), h: clampNum(l.h, 0.03, 1, 0.2), angle: clampNum(l.angle, -90, 90, 0) };
    case "diamond":  return { type, ...b, r: clampNum(l.r ?? l.radius, 0.05, 0.5, 0.3) };
    case "triangle": return { type, ...b, r: clampNum(l.r ?? l.radius, 0.05, 0.5, 0.3) };
    case "sparkle":  return { type, ...b, r: clampNum(l.r ?? l.radius, 0.02, 0.3, 0.12) };
    default: return null;
  }
}

// Arbitrary/partial builder JSON -> a guaranteed-safe { layers: [...] } (or null when nothing usable).
// Drops unknown shape types, clamps every number/colour, caps the layer count. Accepts { layers: [...] }
// or a bare array.
export function coerceItemVisual(raw) {
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

// True when an item carries an authored visual (>=1 valid layer).
export function hasItemVisual(item) {
  return !!(item && item.visual && Array.isArray(item.visual.layers) && item.visual.layers.length);
}

// Builder brief appended to the item designer prompt so the model authors a `visual` the renderer
// accepts (mirrors tileVisualBrief). The coercer re-enforces the allow-list regardless.
export function itemVisualBrief() {
  return `VISUAL: also author a "visual" object — a small ICON for the item, as an ordered list of SHAPE layers composited on a transparent ${ITEM_ICON}x${ITEM_ICON}px square. ALL positions/sizes are fractions 0..1 of the box (cx,cy = centre; 0.5,0.5 = middle). Shape: {"visual":{"layers":[ ... ]}}. Each layer is exactly one of:
- {"type":"disc","cx","cy","r":0.02-0.5,"color":{"r","g","b"},"opacity":0-1} — filled circle (orb/potion body/gem).
- {"type":"ring","cx","cy","r","width":0.01-0.2,"color","opacity"} — circle outline (halo/bezel).
- {"type":"roundrect","cx","cy","w":0.05-1,"h":0.05-1,"radius":0-0.5,"color","opacity"} — rounded box (book/box/tablet).
- {"type":"bar","cx","cy","w","h","angle":-90..90,"color","opacity"} — a bar (handle/wand/blade), rotatable.
- {"type":"diamond","cx","cy","r","color","opacity"} — a gem/crystal.
- {"type":"triangle","cx","cy","r","color","opacity"} — a shard/fang (points up).
- {"type":"sparkle","cx","cy","r":0.02-0.3,"color","opacity"} — a 4-point glint accent.
Use 2-5 layers to build a RECOGNISABLE item silhouette (e.g. a healing vial = a roundrect body + a small roundrect cap + a sparkle; a power gem = a diamond + a ring + a sparkle). Colour it to match the item's effect. Anything outside this schema is dropped.`;
}
