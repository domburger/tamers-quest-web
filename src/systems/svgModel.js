// SVG visual-builder contract (TQ-239, per decision TQ-223: free-form SVG over the authored-shapes
// system). The new visual BUILDER agent authors each creature as complete, self-contained SVG markup
// per ANIMATION STATE on a larger square canvas. This module is the structured-output CONTRACT only —
// the builder PROMPT is TQ-240 and the SAFE render path (sanitize untrusted SVG + rasterize to a
// texture) is TQ-241. It's added ADDITIVELY: the old shapes schema (src/systems/modelRender.js)
// keeps running until the cutover removes it (TQ-242), so nothing breaks while the chain lands.

export const SVG_CANVAS = 256;                               // square viewBox + raster size (>128, per TQ-223)
export const SVG_STATES = ["base", "idle", "attack", "move"]; // base is authored; the rest are optional pose variants

// The geometry/markup an authored SVG state may use. The render path (TQ-241) ENFORCES this by
// sanitizing — these are listed here so the schema field descriptions can steer the builder, and so
// the allow-list has a single source of truth shared by the sanitizer.
export const SVG_ALLOWED_TAGS = ["svg", "g", "path", "ellipse", "circle", "polygon", "polyline", "rect", "line", "defs", "linearGradient", "radialGradient", "stop", "title"];
// Markup that must NEVER appear in an authored state (script execution / external fetches / arbitrary
// HTML). The sanitizer rejects/strips these; the schema descriptions tell the builder not to emit them.
export const SVG_FORBIDDEN = ["script", "foreignObject", "image", "use", "iframe", "audio", "video", "a", "animate", "set", "handler", "style"];

// A self-contained SVG state document: a complete <svg>…</svg> on a 0 0 N N viewBox (N = canvas),
// the creature facing RIGHT and filling most of the frame, using only the allowed vector tags.
const stateDesc = (label, extra) =>
  `${label} as a COMPLETE, self-contained <svg viewBox="0 0 {canvas} {canvas}">…</svg> document, the creature facing RIGHT and filling most of the frame. Use ONLY vector tags (${SVG_ALLOWED_TAGS.join(", ")}); presentation via attributes/fill/stroke/gradients. NEVER emit ${SVG_FORBIDDEN.join(", ")}, external/remote refs (href/xlink:href to URLs), or on* event handlers.${extra || ""}`;

// Structured-output contract for the visual BUILDER. Permissive (mirrors the other gen schemas):
// only `canvas` + `base` are required; idle/attack/move are optional pose variants that fall back to
// `base` when omitted/empty. The builder authors the appearance FROM SCRATCH — no template.
export const SVG_MODEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    canvas: { type: "integer", description: `Square canvas / SVG viewBox size in px — use ${SVG_CANVAS}.` },
    base: { type: "string", description: stateDesc("The creature AT REST") },
    idle: { type: "string", description: stateDesc("Optional: a subtle IDLE pose (gentle breathing/sway)", " Omit or leave empty to reuse base.") },
    attack: { type: "string", description: stateDesc("Optional: an ATTACK pose (lunge/strike)", " Omit or leave empty to reuse base.") },
    move: { type: "string", description: stateDesc("Optional: a MOVING pose (stride/hover)", " Omit or leave empty to reuse base.") },
  },
  required: ["canvas", "base"],
};

// True when a monster carries an authored SVG model — a non-empty `base` state string. (Mirrors
// hasAuthoredModel for the shapes system; the cutover, TQ-242, will switch the detector over.)
export function hasSvgModel(mt) {
  const m = mt && mt.svg;
  return !!(m && typeof m.base === "string" && m.base.trim().length > 0);
}

// The authored states present on a model, each falling back to `base` when a variant is missing —
// the contract the render path (TQ-241) consumes. Pure; does NOT sanitize (that's the render path).
export function svgStates(model) {
  const base = model && typeof model.base === "string" ? model.base : "";
  const out = { base };
  for (const s of SVG_STATES) {
    if (s === "base") continue;
    const v = model && typeof model[s] === "string" && model[s].trim() ? model[s] : base;
    out[s] = v;
  }
  return out;
}
