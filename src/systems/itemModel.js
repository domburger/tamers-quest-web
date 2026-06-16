// Item VISUAL-BUILDER contract.
//
// TQ-393 (Dominik 2026-06-16): the item builder now authors a FREE-FORM HTML/CSS icon, exactly like the
// monster visual builder (htmlModel.js + htmlSanitize.js) — no more fixed shape-types + large structured
// JSON. itemHtmlBrief() is the render-target spec the Builder agent targets; the item stores `html`
// ({canvas, base}) shaped like monster.html, rendered via an SVG-foreignObject raster (src/render/
// htmlRaster.js) into the icon grids + admin preview. SECURITY: the markup goes through the SAME
// default-deny sanitizer the monsters use (sanitizeHtmlModel, htmlSanitize.js) before any DOM/raster.
//
// LEGACY (kept for back-compat — existing items generated before TQ-393): the original structured
// "visual" = an ordered list of SHAPE layers composited (canvas2D) into a small transparent icon
// (drawItemIcon in src/render/itemIcon.js). coerceItemVisual still validates it; generateItemIcon still
// paints it for items that carry a `visual` but no `html`. Framework-agnostic (no DOM) so both the
// server (genItems.js) and the client renderer import it. Geometry is NORMALIZED to 0..1 of the icon box.
import { HTML_CANVAS, HTML_ALLOWED_TAGS, HTML_ALLOWED_CSS_PROPS, HTML_FORBIDDEN } from "./htmlModel.js"; // TQ-393: free HTML/CSS icon builder (reuse the monster allow-lists/sanitizer)
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

// TQ-393: the HTML/CSS render-target brief for the item ICON builder — the free-form replacement for the
// shape-layer spec above. Mirrors htmlModelBrief() (monsters) but tuned for a small, TRANSPARENT, faces-
// agnostic inventory icon rather than a right-facing creature. Re-asserts the allow-list/forbidden set so
// the model targets exactly what the sanitizer (htmlSanitize.js) keeps even if the editable prompt is
// overridden. The builder's SOLE task is the appearance.
export function itemHtmlBrief() {
  const G = HTML_CANVAS;
  return `RENDER TARGET — your SOLE TASK is to draw THIS ITEM as a single self-contained HTML+CSS fragment that renders inside a ${G}x${G}px square box (an inventory ICON).
Structure: ONE root <div> sized to the ${G}x${G} box (position:relative). The box is a TRANSPARENT STAGE — the root <div> MUST NOT paint a backdrop of its own (NO background / background-color / background-image, NO border and NO box-shadow on the ROOT element; those belong only on the item's inner parts) so the icon drops cleanly onto any inventory slot. Build the item FROM SCRATCH from nested <div>/<span> (and optionally inline ${["svg", "path", "ellipse", "circle", "polygon"].join("/")}). CENTER the object; it must FILL most of the box and read clearly even shrunk to ~32px — commit to a BOLD, instantly-recognisable SILHOUETTE first (a vial, a gem, a blade, a tome, a charm…), then layer interior detail.
You MAY animate subtly with ONE <style> block of CSS @keyframes + inline animation (e.g. a glowing potion, a slowly-pulsing gem) — but it MUST still read as a clean STILL image (the icon is captured at rest). No motion is required.
Allowed tags ONLY: ${HTML_ALLOWED_TAGS.join(", ")} (<style> for @keyframes only). Style via inline style attributes; allowed CSS includes ${HTML_ALLOWED_CSS_PROPS.slice(0, 12).join(", ")}, … plus transform/filter/box-shadow/border-radius and the animation properties.
FORBIDDEN (the sanitizer STRIPS these — never emit them): ${HTML_FORBIDDEN.join(", ")}, any external/remote reference (url()/href to a URL, @import), and any on* event handler.
Style: a cohesive GRIM dark-fantasy palette that matches the item's EFFECT (a heal reads green/teal, a fire bomb reads ember, a cleanse reads pale/clean); a BRIGHT accent only for the magical/glowing part. Never pastel or cute. Keep the fragment reasonably compact.`;
}
