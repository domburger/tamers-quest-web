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
// The previous structured shape-layer "visual" builder (coerceTileVisual + the gradient/speckle/cracks/…
// schema + paintVisualLayers in render/tiles.js) was REMOVED with the back-compat path (Dominik
// 2026-06-16). Generated tiles render ONLY from `html` now; SEED tiles (groundtiles.json) keep their
// base-colour procedural grain (render/tiles.js generateTileTexture) — that is the foundational floor
// renderer maps depend on, NOT the removed shape-builder. Framework-agnostic (no DOM) so the server
// (genTiles.js) can import the brief.

import { HTML_CANVAS, HTML_ALLOWED_TAGS, HTML_ALLOWED_CSS_PROPS, HTML_FORBIDDEN } from "./htmlModel.js"; // free HTML/CSS tile builder (reuse the monster allow-lists/sanitizer)

export const TILE_CANVAS = 64; // matches the TEX size generateTileTexture bakes at

// TQ-393: the HTML/CSS render-target brief for the ground-TILE builder. Mirrors htmlModelBrief()
// (monsters) / itemHtmlBrief() but tuned for a FULL-BLEED,
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
