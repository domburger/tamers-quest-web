// Served raw at /admin/ by server/index.js: keep this file import-free.

export const HTML_CANVAS = 256;
export const HTML_STATES = ["base", "idle", "attack", "move"];

// Enforced by htmlSanitize.js; renders as live DOM, so allow only inert presentational items.
export const HTML_ALLOWED_TAGS = ["div", "span", "svg", "g", "path", "ellipse", "circle", "polygon", "polyline", "rect", "line", "defs", "linearGradient", "radialGradient", "stop", "style"];
export const HTML_ALLOWED_ATTRS = ["class", "style", "viewBox", "d", "cx", "cy", "rx", "ry", "r", "x", "y", "x1", "y1", "x2", "y2", "width", "height", "points", "fill", "stroke", "stroke-width", "transform", "offset", "stop-color", "gradientUnits",
  "opacity", "stroke-linecap", "stroke-linejoin", "stroke-opacity", "fill-opacity", "stop-opacity", "stroke-dasharray",
  "stroke-dashoffset", "fill-rule", "id"];
export const HTML_ALLOWED_CSS_PROPS = [
  "position", "left", "top", "right", "bottom", "width", "height", "margin", "padding", "box-sizing",
  "background", "background-color", "background-image", "border", "border-radius", "box-shadow", "opacity",
  "color", "filter", "transform", "transform-origin", "transition", "clip-path", "overflow",
  "display", "flex", "align-items", "justify-content", "gap", "z-index", "inset",
  "border-left", "border-right", "border-top", "border-bottom", "border-color", "border-width", "border-style",
  "border-left-color", "border-right-color", "border-top-color", "border-bottom-color",
  "border-left-width", "border-right-width", "border-top-width", "border-bottom-width",
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-opacity", "fill-opacity",
  "stroke-dasharray", "stroke-dashoffset", "pointer-events",
  "animation", "animation-name", "animation-duration", "animation-timing-function", "animation-delay",
  "animation-iteration-count", "animation-direction", "animation-fill-mode", "animation-play-state",
];
// style is deliberately absent: htmlSanitize allows it for @keyframes only.
export const HTML_FORBIDDEN = ["script", "link", "iframe", "object", "embed", "img", "image", "a", "form", "input", "video", "audio", "foreignObject", "use", "animate", "set", "meta", "base", "template"];

const stateDesc = (label, extra) =>
  `${label} as a COMPLETE, self-contained HTML fragment: ONE root <div> sized to the ${HTML_CANVAS}x${HTML_CANVAS} canvas, the creature built FROM SCRATCH from nested div/span (and optionally inline ${["svg", "path", "ellipse", "circle", "polygon"].join("/")}). Presentation via INLINE style only (allowed CSS: shape, gradient, transform, filter, box-shadow, border-radius, animation). NEVER emit ${HTML_FORBIDDEN.join(", ")}, external/remote refs (url()/href to a URL, @import), or on* event handlers.${extra || ""}`;

// Keys must stay model.*: server/genPipeline.js spreads them into SCHEMA_DESC_DEFAULTS.
export const HTML_SCHEMA_DESC_DEFAULTS = {
  "model.base": stateDesc("The whole creature, authored ONCE, ALIVE and continuously animating (looping CSS @keyframes)"),
};
const htmlDefaultDesc = (k) => HTML_SCHEMA_DESC_DEFAULTS[k] ?? "";

export function buildHtmlModelSchema(d = htmlDefaultDesc) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      canvas: { type: "integer", description: `Square render-box size in px — use ${HTML_CANVAS}.` },
      base: { type: "string", description: d("model.base") },
    },
    required: ["canvas", "base"],
  };
}

export const HTML_MODEL_SCHEMA = buildHtmlModelSchema();

export function hasHtmlModel(mt) {
  const m = mt && mt.html;
  return !!(m && typeof m.base === "string" && m.base.trim().length > 0);
}

export function htmlStates(model) {
  const base = model && typeof model.base === "string" ? model.base : "";
  const out = { base };
  for (const s of HTML_STATES) {
    if (s === "base") continue;
    const v = model && typeof model[s] === "string" && model[s].trim() ? model[s] : base;
    out[s] = v;
  }
  return out;
}

export function pickStateHtml(model, state) {
  if (!model) return "";
  const base = typeof model.base === "string" ? model.base : "";
  if (state && state !== "base") {
    const v = model[state];
    if (typeof v === "string" && v.trim()) return v;
  }
  return base;
}

export function isRenderableHtml(markup) {
  return typeof markup === "string" && /<[a-z][\s\S]*>/i.test(markup) && markup.trim().length > 0;
}

export function coerceHtmlModel(raw) {
  if (!raw || typeof raw !== "object") return null;
  const base = isRenderableHtml(raw.base) ? String(raw.base).trim() : "";
  if (!base) return null;
  const out = { canvas: HTML_CANVAS, base };
  for (const s of HTML_STATES) {
    if (s === "base") continue;
    if (isRenderableHtml(raw[s])) out[s] = String(raw[s]).trim();
  }
  return out;
}

export function htmlModelBrief() {
  const G = HTML_CANVAS;
  return `RENDER TARGET — your SOLE TASK is to draw this ONE creature as a single HTML+CSS fragment. Author it FROM SCRATCH (no template) as ONE complete, self-contained fragment that renders inside a ${G}x${G}px square box.
Structure: ONE root <div> sized to the ${G}x${G} box (position:relative). The box is a TRANSPARENT STAGE: the root <div> MUST NOT paint a backdrop of its own — NO background / background-color / background-image, NO border and NO box-shadow on the ROOT element (a dark/filled square box behind the creature is WRONG; those styles belong only on the creature's inner parts). Only the creature itself is visible so the sprite drops cleanly onto any ground. Build the creature from nested <div>/<span>, optionally inline <svg> using ${["path", "ellipse", "circle", "polygon"].join("/")}. The creature FACES RIGHT and FILLS most of the box.
ANIMATE it — the creature must look ALIVE and be in continuous motion, NEVER a static pose. Include ONE <style> block containing CSS @keyframes, and drive your elements with inline animation (e.g. style="animation: breathe 2.6s ease-in-out infinite"). You have COMPLETE freedom over how it moves: animate whatever parts YOU invented, in any way that fits this creature — do NOT follow a template, and there are NO prescribed body parts or motions.
OPTIONAL action reactions: the engine adds a class to the creature's root when it moves or attacks — .tq-moving and .tq-attacking. You MAY (but need not) add scoped style rules that react, e.g. .tq-attacking { animation: lunge .3s ease } or .tq-attacking .arm { transform: rotate(20deg) }. Rules MUST be scoped under .tq-moving / .tq-attacking (descendant selectors only); idle motion stays your continuous @keyframes. Inside <style> only @keyframes and these .tq-moving/.tq-attacking-scoped rules survive — any other selector / @import / at-rule is stripped.
Allowed tags ONLY: ${HTML_ALLOWED_TAGS.join(", ")} (<style> for @keyframes only). Style via inline style attributes; allowed CSS includes ${HTML_ALLOWED_CSS_PROPS.slice(0, 12).join(", ")}, … plus transform/filter/box-shadow/border-radius and the animation properties.
FORBIDDEN (the sanitizer STRIPS these — never emit them): ${HTML_FORBIDDEN.join(", ")}, any external/remote reference (url()/href to a URL, @import), and any on* event handler.
Style: a cohesive GRIM palette (dark desaturated body; a BRIGHT accent ONLY for eyes/glowing parts), never pastel or cute. Build a BOLD, readable predator SILHOUETTE first, then layer interior detail. Keep each fragment reasonably compact.`;
}
