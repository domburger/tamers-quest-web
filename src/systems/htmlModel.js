// HTML/CSS visual-builder contract (TQ-259, per decision TQ-254 Option 3: full swap to HTML/CSS for
// monster visuals). The visual BUILDER agent authors each creature as free-form HTML+CSS per ANIMATION
// STATE; monsters render as LIVE DOM elements with CSS animation (idle/attack/move). This replaces the
// SVG builder (src/systems/svgModel.js, TQ-224) and the older shapes system.
//
// This module is the structured-output CONTRACT + the shared ALLOW-LISTS only. The builder PROMPT is
// TQ-260; the security-critical SANITIZER for untrusted HTML/CSS is TQ-261 (it ENFORCES the allow-lists
// below); the live-DOM render path is TQ-262. It is added ADDITIVELY here — coerceHtmlModel does only
// minimal shape-coercion; nothing renders monster.html until the sanitizer + render path land.

export const HTML_CANVAS = 256;                                // square render box (px) the markup is authored against
export const HTML_STATES = ["base", "idle", "attack", "move"]; // base is authored; the rest are optional animation states

// The allow-lists the TQ-261 sanitizer ENFORCES (single source of truth, shared with the builder
// prompt so the model targets exactly what survives sanitizing). Conservative by design — live DOM is
// a far larger attack surface than rasterized SVG, so only presentational, inert elements/props.
// `style` is allowed ONLY as a carrier for CSS @keyframes (TQ-305) — the sanitizer reduces a <style>
// block's content to validated @keyframes and drops it entirely if none survive. It is NOT a general
// styling element (no selectors/imports). Everything else is presentational + inert.
export const HTML_ALLOWED_TAGS = ["div", "span", "svg", "g", "path", "ellipse", "circle", "polygon", "polyline", "rect", "line", "defs", "linearGradient", "radialGradient", "stop", "style"];
export const HTML_ALLOWED_ATTRS = ["class", "style", "viewBox", "d", "cx", "cy", "rx", "ry", "r", "x", "y", "x1", "y1", "x2", "y2", "width", "height", "points", "fill", "stroke", "stroke-width", "transform", "offset", "stop-color", "gradientUnits"];
// CSS properties an authored fragment's inline style / @keyframes step may use (presentation + CSS
// animation only). The sanitizer drops anything outside this set, and url()/expression()/@import.
export const HTML_ALLOWED_CSS_PROPS = [
  "position", "left", "top", "right", "bottom", "width", "height", "margin", "padding", "box-sizing",
  "background", "background-color", "background-image", "border", "border-radius", "box-shadow", "opacity",
  "color", "filter", "transform", "transform-origin", "transition", "clip-path", "overflow",
  "display", "flex", "align-items", "justify-content", "gap", "z-index", "inset",
  // CSS animation (TQ-305): the shorthand + longhands so a builder can drive @keyframes either way.
  "animation", "animation-name", "animation-duration", "animation-timing-function", "animation-delay",
  "animation-iteration-count", "animation-direction", "animation-fill-mode", "animation-play-state",
];
// Markup/CSS that must NEVER appear (script execution / external fetches / event wiring / navigation).
// The sanitizer strips these; the schema descriptions + brief tell the builder not to emit them. NOTE:
// `style` is intentionally NOT here — it is conditionally allowed for @keyframes only (see above, TQ-305).
export const HTML_FORBIDDEN = ["script", "link", "iframe", "object", "embed", "img", "image", "a", "form", "input", "video", "audio", "foreignObject", "use", "animate", "set", "meta", "base", "template"];

// A self-contained HTML/CSS state: a complete fragment rooted in a single <div> sized to the canvas,
// the creature drawn with nested div/span (+ an optional inline SVG subset), styled via inline style.
const stateDesc = (label, extra) =>
  `${label} as a COMPLETE, self-contained HTML fragment: ONE root <div> sized to the ${HTML_CANVAS}x${HTML_CANVAS} canvas, the creature built FROM SCRATCH from nested div/span (and optionally inline ${["svg", "path", "ellipse", "circle", "polygon"].join("/")}). Presentation via INLINE style only (allowed CSS: shape, gradient, transform, filter, box-shadow, border-radius, animation). NEVER emit ${HTML_FORBIDDEN.join(", ")}, external/remote refs (url()/href to a URL, @import), or on* event handlers.${extra || ""}`;

// Default field description for the builder's authored state — admin-editable via the schemaDesc
// override system (mirrors svgModel.js / TQ-253). The key is namespaced model.* so genPipeline spreads
// it into SCHEMA_DESC_DEFAULTS and getSchemaDesc resolves/overrides it. SAFETY is NOT delegated here:
// HTML_FORBIDDEN + the allow-lists are re-asserted by htmlModelBrief() AND enforced by the TQ-261
// sanitizer regardless of any edit to this description.
//
// TQ-303 (TQ-297 B): the builder authors the creature ONCE — only `base`. idle/attack/move were
// dropped from the schema (they made the model re-emit the WHOLE creature per state — wasted tokens,
// drift — yet couldn't even self-animate, since the sanitizer strips <style>/@keyframes). The
// render path still TOLERATES authored states on already-stored models (back-compat); the engine
// drives idle/attack/move motion by transforming the single base node (follow-up).
export const HTML_SCHEMA_DESC_DEFAULTS = {
  "model.base": stateDesc("The whole creature, authored ONCE, ALIVE and continuously animating (looping CSS @keyframes)"),
};
const htmlDefaultDesc = (k) => HTML_SCHEMA_DESC_DEFAULTS[k] ?? "";

// Build the builder's structured-output contract. Per-state field descriptions resolve through `d`
// (the override-aware getSchemaDesc in the live stage; defaults otherwise). `canvas` keeps a fixed,
// code-authoritative size constraint and is intentionally NOT operator-editable. Mirrors buildSvgModelSchema.
// TQ-303 (TQ-297 B): the builder authors ONLY `base` — one complete creature. idle/attack/move are
// intentionally NOT in the output schema, so the model cannot re-emit the whole creature per state.
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

// The default contract (defaults applied) — used for the admin read-only schema view + tests.
export const HTML_MODEL_SCHEMA = buildHtmlModelSchema();

// True when a monster carries an authored HTML model — a non-empty `base` state string.
export function hasHtmlModel(mt) {
  const m = mt && mt.html;
  return !!(m && typeof m.base === "string" && m.base.trim().length > 0);
}

// The authored states present on a model, each falling back to `base` when a variant is missing — the
// contract the render path (TQ-262) consumes. Pure; does NOT sanitize (that's the render path/TQ-261).
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

// The single-state fragment for `state`, falling back to base when that variant is absent/empty — the
// per-frame accessor the render path (TQ-262) uses to set a node's innerHTML. `model` is the stored
// states object ({ base, idle?, attack?, move? }); returns "" when there's no usable base. Pure.
export function pickStateHtml(model, state) {
  if (!model) return "";
  const base = typeof model.base === "string" ? model.base : "";
  if (state && state !== "base") {
    const v = model[state];
    if (typeof v === "string" && v.trim()) return v;
  }
  return base;
}

// True when markup looks like a renderable HTML fragment (has a tag). NOT a security check — the
// TQ-261 sanitizer is the safety boundary; this just rejects empty/plain-text junk pre-persist.
export function isRenderableHtml(markup) {
  return typeof markup === "string" && /<[a-z][\s\S]*>/i.test(markup) && markup.trim().length > 0;
}

// Coerce the raw builder output into a stored model: keep the base + any present states (trimmed),
// clamp the canvas, drop non-renderable junk. Returns null when there's no usable base (so the pipeline
// leaves the monster model-less → archetype fallback). MINIMAL by design — the real allow-list
// enforcement is the TQ-261 sanitizer, applied on the render path before any DOM insertion.
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

// The builder PROMPT brief (render-target spec appended to the admin-editable builder system prompt so
// the model always targets exactly what the sanitizer accepts, even if the editable prompt is
// overridden). The builder's SOLE task is the appearance. Mirrors svgModelBrief(); refined in TQ-260.
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
