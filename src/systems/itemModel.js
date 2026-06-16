// Item VISUAL-BUILDER contract.
//
// TQ-393 (Dominik 2026-06-16): the item builder authors a FREE-FORM HTML/CSS icon, exactly like the
// monster visual builder (htmlModel.js + htmlSanitize.js). itemHtmlBrief() is the render-target spec the
// Builder agent targets; the item stores `html` ({canvas, base}) shaped like monster.html, rendered via
// an SVG-foreignObject raster (src/render/htmlRaster.js) into the icon grids + admin preview. SECURITY:
// the markup goes through the SAME default-deny sanitizer the monsters use (sanitizeHtmlModel,
// htmlSanitize.js) before any DOM/raster.
//
// The previous structured shape-layer "visual" builder (coerceItemVisual + the disc/ring/roundrect/…
// schema + render/itemIcon.js) was REMOVED with the back-compat path (Dominik 2026-06-16) — items render
// ONLY from `html` now (no `visual` fallback). Framework-agnostic (no DOM) so the server (genItems.js)
// can import the brief.
import { HTML_CANVAS, HTML_ALLOWED_TAGS, HTML_ALLOWED_CSS_PROPS, HTML_FORBIDDEN } from "./htmlModel.js"; // free HTML/CSS icon builder (reuse the monster allow-lists/sanitizer)

// TQ-393: the HTML/CSS render-target brief for the item ICON builder. Mirrors htmlModelBrief() (monsters)
// but tuned for a small, TRANSPARENT, faces-
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
