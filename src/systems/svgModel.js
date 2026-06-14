// SVG visual-builder contract (TQ-239, per decision TQ-223: free-form SVG over the old authored-shapes
// system). The visual BUILDER agent authors each creature as complete, self-contained SVG markup per
// ANIMATION STATE on a larger square canvas. This module is the structured-output CONTRACT + the SAFE
// render path: the builder PROMPT is TQ-240, sanitizing untrusted SVG + rasterizing to a texture is
// TQ-241. The old shapes system (src/systems/modelRender.js) it replaced was removed in the cutover
// (TQ-242); this is now the sole monster visual-builder path.

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

// TQ-240: the SVG builder PROMPT brief — the render-target spec appended to the (admin-editable)
// builder system prompt so the model always targets exactly what the sanitizer (TQ-241) accepts and
// the rasterizer draws, even if the editable prompt is overridden. The builder's SOLE task is the
// appearance. Mirrors authoredModelBrief() for the old shapes system; wired in at cutover (TQ-242).
export function svgModelBrief() {
  const G = SVG_CANVAS, ground = Math.round(SVG_CANVAS * 0.9);
  return `RENDER TARGET — your SOLE TASK is to draw this ONE creature as SVG. Author it FROM SCRATCH (no template) as complete, self-contained <svg> documents — one per animation STATE — on a ${G}x${G} square viewBox.
Frame: viewBox "0 0 ${G} ${G}", origin top-left, x increases RIGHT, y increases DOWN. The creature FACES RIGHT, stands/sits on a ground line near y≈${ground}, and FILLS most of the frame (roughly the central 70%).
States: output "base" (at rest) — REQUIRED — plus optional "idle" (subtle breathing/sway), "attack" (lunge/strike), and "move" (stride/hover). Omit a variant to reuse base. Each state is an INDEPENDENT, well-formed <svg>…</svg> document.
Allowed markup ONLY: ${SVG_ALLOWED_TAGS.join(", ")} — compose from paths/ellipses/polygons; fill + stroke for shading; <linearGradient>/<radialGradient> in <defs> for depth.
FORBIDDEN (the render path STRIPS these — never emit them): ${SVG_FORBIDDEN.join(", ")}, any external/remote reference (href / xlink:href to a URL), and any on* event handler.
Style: a cohesive GRIM palette (dark desaturated body; a BRIGHT accent ONLY for eyes/glowing parts), never pastel or cute. Build a BOLD, readable predator SILHOUETTE first, then layer interior detail (musculature, plates, horns, eyes/teeth on top). Keep each document reasonably compact.`;
}

// ── TQ-241: SAFE RENDER PATH (sanitize untrusted SVG + rasterize to a texture) ───────────────────
// SECURITY MODEL: the builder's SVG is UNTRUSTED. The real safety boundary is that we rasterize each
// state via an <img> data-URL (rasterizeSvg) — browsers do NOT execute scripts, run event handlers,
// or render <foreignObject> HTML for SVG loaded as an image, so no markup can execute. sanitizeSvg is
// DEFENSE-IN-DEPTH on top: it strips script/handler/external-fetch vectors so a bad doc can't even
// phone home, and bounds the size. Conservative — when in doubt, strip.

// Pure string transform; runs on the server (validation) and the client (pre-raster).
export function sanitizeSvg(markup, { maxLen = 40000 } = {}) {
  let s = typeof markup === "string" ? markup : "";
  if (s.length > maxLen) s = s.slice(0, maxLen);
  // Strip XML/doctype preambles + comments (a comment can hide a CDATA script in some parsers).
  s = s.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  // Remove every FORBIDDEN element entirely (paired, self-closing, or unclosed).
  for (const tag of SVG_FORBIDDEN) {
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "");
    s = s.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), "");
  }
  // Strip on*="…" event handlers.
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // href / xlink:href: keep ONLY local fragment refs (#id, for gradients); drop URLs, javascript:, data:.
  s = s.replace(/\s(?:xlink:href|href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (m, _q, dq, sq, bare) => {
    const v = (dq ?? sq ?? bare ?? "").trim();
    return v.startsWith("#") ? m : "";
  });
  // An SVG loaded via an <img> data-URL (the safe render path, rasterizeSvg) renders BLANK unless the
  // root <svg> declares the SVG namespace — and the builder brief doesn't require xmlns, so models
  // routinely omit it. Inject it on the root tag when absent so every authored state actually paints
  // (this is what made generated monsters fall back to a blank/archetype sprite). Single source of
  // truth: rasterizeSvg + the game render path both go through here.
  s = s.replace(/<svg\b([^>]*)>/i, (m, attrs) => (/\bxmlns\s*=/i.test(attrs) ? m : `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>`));
  return s.trim();
}

// True when, after sanitizing, the markup has a usable <svg> root.
export function isRenderableSvg(markup) {
  const s = sanitizeSvg(markup);
  return /<svg[\s>]/i.test(s) && /<\/svg\s*>/i.test(s);
}

// Rasterize a sanitized SVG state onto an offscreen canvas (BROWSER-ONLY — uses <img>, the safe path).
// Returns a Promise<HTMLCanvasElement|null> (size×size). Null when there's no DOM (server) or the SVG
// can't load. Callers cache the canvas per state and draw it as the monster's sprite.
export function rasterizeSvg(markup, size = SVG_CANVAS) {
  if (typeof document === "undefined" || typeof Image === "undefined") return Promise.resolve(null);
  const safe = sanitizeSvg(markup);
  if (!/<svg[\s>]/i.test(safe)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement("canvas");
        cv.width = size; cv.height = size;
        cv.getContext("2d").drawImage(img, 0, 0, size, size);
        resolve(cv);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(safe);
  });
}

// TQ-245: coerce the raw builder output into a render-ready SVG model — SANITIZE the base + each
// present state, keep only states with a renderable <svg> (missing variants fall back to base at
// render time via svgStates), clamp the canvas. Returns null when there's no usable base (so the
// pipeline leaves the monster model-less -> archetype fallback). Mirrors coerceAuthoredModel.
export function coerceSvgModel(raw) {
  if (!raw || typeof raw !== "object") return null;
  const base = isRenderableSvg(raw.base) ? sanitizeSvg(raw.base) : "";
  if (!base) return null;
  const out = { canvas: SVG_CANVAS, base };
  for (const s of SVG_STATES) {
    if (s === "base") continue;
    if (isRenderableSvg(raw[s])) out[s] = sanitizeSvg(raw[s]);
  }
  return out;
}
