// TQ-274 (Phase 2, engine-removal TQ-227/229): the k.draw* → cDraw* ADAPTER. The kaboom/Phaser shim's
// immediate-mode draws (kaboomShim.js k.drawRect/drawCircle/…) take { pos: vec2, anchor, color: KColor,
// opacity, outline, … } in DESIGN coords and supersample (×SS) onto a Phaser backing. The canvas
// backend's cDraw* primitives take { x, y, color: [r,g,b], … } in DESIGN coords and the runtime
// (makeCanvasRuntime) applies DPR×FIT. This module bridges the two so a real scene's k.draw* calls can
// render on the canvas backend unchanged — no SS here (the runtime owns DPR/FIT). Pure (operates on a
// 2D ctx); no Phaser, no DOM. drawSprite is intentionally a no-op: sprites need the texture registry (Phase 5).
import { cDrawRect, cDrawCircle, cDrawEllipse, cDrawLine, cDrawText, cDrawPoly, makeCanvasRuntime } from "./canvasBackend.js";

// Anchor → [ox,oy] origin (0..1), mirroring kaboomShim.js ANCHORS exactly (default topleft).
const ANCHORS = {
  topleft: [0, 0], top: [0.5, 0], topright: [1, 0],
  left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
  botleft: [0, 1], bottomleft: [0, 1], bot: [0.5, 1], bottom: [0.5, 1],
  botright: [1, 1], bottomright: [1, 1],
};
export function anchorOrigin(anchor) { return ANCHORS[anchor] || ANCHORS.topleft; }

/**
 * Color → [r,g,b]. Accepts a KColor-shaped object (duck-typed .r/.g/.b, 0..255) OR an [r,g,b] array;
 * defaults to white (matching the shim's 0xffffff fallback). Pure; duck-typed so it doesn't import
 * KColor (no coupling to the Phaser shim).
 * @param {any} color @returns {[number,number,number]}
 */
export function toRGB(color) {
  if (color && typeof color.r === "number" && typeof color.g === "number" && typeof color.b === "number") {
    return [color.r, color.g, color.b];
  }
  if (Array.isArray(color)) return color;
  return [255, 255, 255];
}

const px = (p) => (p && typeof p.x === "number" ? p.x : 0);
const py = (p) => (p && typeof p.y === "number" ? p.y : 0);
const outlineOf = (o) => (o && o.outline ? { width: o.outline.width || 1, color: toRGB(o.outline.color) } : null);

/**
 * Build a draw surface matching the shim's k.draw* call shapes, backed by `ctx` + the cDraw* primitives.
 * All inputs are DESIGN coords; anchors offset rects (text/circle/ellipse anchor via their own
 * baseline/centre, like the shim). Returns an object the scenes' onDraw code can call as `k`.
 * @param {CanvasRenderingContext2D} ctx
 */
export function makeCanvasRenderer(ctx) {
  return {
    drawRect(o = {}) {
      const w = o.width || 0, h = o.height || 0;
      const [ox, oy] = anchorOrigin(o.anchor || "topleft");
      cDrawRect(ctx, {
        x: px(o.pos) - w * ox, y: py(o.pos) - h * oy, w, h,
        color: toRGB(o.color), opacity: o.opacity ?? 1, radius: o.radius || 0,
        fill: o.fill !== false, outline: outlineOf(o),
      });
    },
    drawCircle(o = {}) {
      cDrawCircle(ctx, {
        x: px(o.pos), y: py(o.pos), radius: o.radius || 0,
        color: toRGB(o.color), opacity: o.opacity ?? 1, fill: o.fill !== false, outline: outlineOf(o),
      });
    },
    drawEllipse(o = {}) {
      cDrawEllipse(ctx, {
        x: px(o.pos), y: py(o.pos), radiusX: o.radiusX || 0, radiusY: o.radiusY || 0,
        color: toRGB(o.color), opacity: o.opacity ?? 1,
      });
    },
    drawLine(o = {}) {
      cDrawLine(ctx, { p1: o.p1 || { x: 0, y: 0 }, p2: o.p2 || { x: 0, y: 0 }, width: o.width || 1, color: toRGB(o.color), opacity: o.opacity ?? 1 });
    },
    drawText(o = {}) {
      cDrawText(ctx, {
        text: o.text == null ? "" : o.text, x: px(o.pos), y: py(o.pos), size: o.size || 16,
        color: toRGB(o.color), opacity: o.opacity ?? 1, anchor: o.anchor || "topleft",
        font: o.font || "sans-serif", width: o.width || 0, // k.drawText: o.width = wrap width
      });
    },
    drawPolygon(o = {}) {
      cDrawPoly(ctx, { points: o.pts || o.points || [], color: toRGB(o.color), opacity: o.opacity ?? 1 });
    },
    drawSprite() { /* Phase 5 (TQ-232): sprites need the texture registry; no-op until then. */ },
    // TQ-275: the color + vec constructors scenes/UI helpers use (theme.js: `k.rgb(...t)`, `k.vec2(x,y)`),
    // so production draw code (drawButton/drawPanel/…) routes through this adapter unmodified. rgb returns
    // a KColor-shaped object that toRGB() consumes; it also passes a lone array/KColor through.
    rgb(...c) {
      if (c.length === 1) {
        const v = c[0];
        if (Array.isArray(v)) return { r: v[0] || 0, g: v[1] || 0, b: v[2] || 0 };
        if (v && typeof v.r === "number") return v;
      }
      return { r: c[0] || 0, g: c[1] || 0, b: c[2] || 0 };
    },
    vec2(x = 0, y = 0) { return { x, y }; },
  };
}

// A small reference scene authored ENTIRELY against the renderer's k.draw* surface (KColor-shaped colors
// + anchors + outline + wrap), proving the adapter renders a real onDraw composition end-to-end. Pure +
// deterministic (index/trig). `t` is seconds (one gentle animated element so the loop is observable).
export function drawRendererDemo(r, t = 0) {
  const C = (red, g, b) => ({ r: red, g, b }); // KColor-shaped (duck-typed .r/.g/.b)
  r.drawRect({ pos: { x: 0, y: 0 }, width: 1280, height: 720, color: C(18, 20, 27) });
  // centre-anchored bordered panel
  r.drawRect({ pos: { x: 640, y: 360 }, width: 380, height: 180, anchor: "center", color: C(28, 34, 44), opacity: 0.92, radius: 12, outline: { width: 2, color: C(70, 230, 198) } });
  r.drawText({ pos: { x: 640, y: 296 }, text: "Canvas renderer", size: 26, color: C(240, 243, 244), anchor: "center" });
  r.drawText({ pos: { x: 510, y: 336 }, text: "A real onDraw scene authored against the k.draw* adapter — wrapped, anchored, outlined.", size: 14, color: C(176, 200, 210), width: 260 });
  // outline-only ring + filled (pulsing) circle + ellipse shadow
  r.drawCircle({ pos: { x: 340, y: 360 }, radius: 44, fill: false, outline: { width: 3, color: C(98, 160, 255) } });
  r.drawCircle({ pos: { x: 940, y: 360 }, radius: 30 + Math.sin(t) * 6, color: C(255, 184, 66), opacity: 0.85 });
  r.drawEllipse({ pos: { x: 640, y: 580 }, radiusX: 130, radiusY: 36, color: C(58, 110, 150), opacity: 0.8 });
  // baseline + a triangle (polygon)
  r.drawLine({ p1: { x: 200, y: 640 }, p2: { x: 1080, y: 640 }, width: 3, color: C(70, 230, 198), opacity: 0.5 });
  r.drawPolygon({ pts: [{ x: 600, y: 150 }, { x: 640, y: 110 }, { x: 680, y: 150 }], color: C(222, 74, 40) });
  // right-anchored label (exercises anchor on text)
  r.drawText({ pos: { x: 1260, y: 12 }, text: "k.draw* → cDraw* adapter", size: 16, color: C(70, 230, 198), anchor: "topright" });
}

/** Boot the canvas backend rendering the adapter reference scene (browser only; QA/render-verify). */
export function startCanvasRendererDemo() {
  return makeCanvasRuntime((ctx, t) => drawRendererDemo(makeCanvasRenderer(ctx), t));
}
