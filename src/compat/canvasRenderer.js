// TQ-274 (Phase 2, engine-removal TQ-227/229): the k.draw* → cDraw* ADAPTER. The kaboom/Phaser shim's
// immediate-mode draws (kaboomShim.js k.drawRect/drawCircle/…) take { pos: vec2, anchor, color: KColor,
// opacity, outline, … } in DESIGN coords and supersample (×SS) onto a Phaser backing. The canvas
// backend's cDraw* primitives take { x, y, color: [r,g,b], … } in DESIGN coords and the runtime
// (makeCanvasRuntime) applies DPR×FIT. This module bridges the two so a real scene's k.draw* calls can
// render on the canvas backend unchanged — no SS here (the runtime owns DPR/FIT). Pure (operates on a
// 2D ctx); no Phaser, no DOM. drawSprite is intentionally a no-op: sprites need the texture registry (Phase 5).
import { cDrawRect, cDrawCircle, cDrawEllipse, cDrawLine, cDrawText, cDrawPoly } from "./canvasBackend.js";

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
 * TQ-284 (Phase 5): blit a texture (canvas/image/bitmap) with the shim's k.drawSprite semantics in DESIGN
 * coords — anchor offsets the draw (origin), width/height OR scale×natural sets the size, angle rotates
 * about the anchor (degrees), opacity = globalAlpha. The runtime owns DPR/FIT, so no SS here.
 */
export function cDrawSprite(ctx, { image, x = 0, y = 0, width, height, scale = 1, angle = 0, anchor = "topleft", opacity = 1 } = {}) {
  if (!image) return;
  const natW = image.width || image.naturalWidth || 0, natH = image.height || image.naturalHeight || 0;
  const w = width != null ? width : natW * scale;
  const h = height != null ? height : natH * scale;
  if (!(w > 0 && h > 0)) return;
  const [ox, oy] = anchorOrigin(anchor);
  ctx.save();
  ctx.globalAlpha = opacity;
  if (angle) {
    ctx.translate(x, y);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.drawImage(image, -w * ox, -h * oy, w, h);
  } else {
    ctx.drawImage(image, x - w * ox, y - h * oy, w, h);
  }
  ctx.restore();
}

/**
 * Build a draw surface matching the shim's k.draw* call shapes, backed by `ctx` + the cDraw* primitives.
 * All inputs are DESIGN coords; anchors offset rects (text/circle/ellipse anchor via their own
 * baseline/centre, like the shim). Returns an object the scenes' onDraw code can call as `k`.
 * @param {CanvasRenderingContext2D} ctx
 */
export function makeCanvasRenderer(ctx, { textures } = {}) {
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
    // TQ-284 (Phase 5): blit a named texture from the registry (or an explicit o.image). A missing
    // texture is a no-op (keeps the loop alive) rather than the shim's throw.
    drawSprite(o = {}) {
      const image = o.image || (textures && o.sprite != null ? textures.get(o.sprite) : null);
      if (!image) return;
      cDrawSprite(ctx, {
        image, x: px(o.pos), y: py(o.pos), width: o.width, height: o.height,
        scale: o.scale ?? 1, angle: o.angle || 0, anchor: o.anchor || "topleft", opacity: o.opacity ?? 1,
      });
    },
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
    // TQ-278: sub-rect clip, matching the shim's k.pushClip/k.popClip (kaboomShim.js) — scopes
    // subsequent draws to a rect (in-lobby station popups / scrolling card grids). Nestable: each
    // pushClip saves the ctx + intersects the clip; popClip restores. Design coords (runtime owns DPR/FIT).
    pushClip(x = 0, y = 0, w = 0, h = 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
    },
    popClip() { ctx.restore(); },
  };
}

// (TQ-341) The TQ-274 `drawRendererDemo` reference scene was removed as dead code — it proved the
// k.draw* → cDraw* adapter during the cutover spike and has no production caller now that the real
// scenes drive the adapter. The adapter itself (makeCanvasRenderer above) is exercised by every scene.
