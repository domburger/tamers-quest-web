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

// Memoize the KColor for each (r,g,b) k.rgb() produces. k.rgb is THE colour constructor every draw call
// routes through, and the game reuses a small, mostly-static palette (theme colours, cosmetics, biome
// tints, a handful of literals) thousands of times per frame — so without this every draw allocated a
// fresh {r,g,b}. Returning a SHARED cached object is safe: nothing in the codebase mutates a colour's
// channels (verified) and the draw adapter copies them out immediately; k.rgb's single-arg KColor branch
// already returns a non-fresh object, so callers never relied on identity/freshness. Keyed on the packed
// rgb int (cheap, no string). A size backstop clears the Map if some unexpected effect floods it with
// distinct colours, so it can never grow unbounded. (Per-file colour-helper caches — character/chain/hub/
// portal — already do this locally; this catches the remaining INLINE k.rgb calls game-wide.)
const _rgbCache = new Map();
function _kcol(r, g, b) {
  const key = ((r | 0) << 16) | ((g | 0) << 8) | (b | 0);
  let v = _rgbCache.get(key);
  if (v === undefined) {
    if (_rgbCache.size >= 4096) _rgbCache.clear();
    v = { r, g, b };
    _rgbCache.set(key, v);
  }
  return v;
}
// Pass the outline colour through unchanged (KColor or array) — cDraw*'s rgba() handles both, so no
// per-draw array allocation (TQ: drop the toRGB intermediate from the geometry draw path).
const outlineOf = (o) => (o && o.outline ? { width: o.outline.width || 1, color: o.outline.color } : null);

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
export function makeCanvasRenderer(ctx, { textures, labelCache } = {}) {
  // TQ-443 (opt 1): per-frame shadow of the last text-draw style. font/textBaseline/textAlign are written
  // ONLY by text draws, so this can't be invalidated by an intervening rect/sprite — only by pushClip/
  // popClip (ctx save/restore) below. Fresh per renderer == fresh per frame, so it starts clean each frame.
  const textState = { font: null, baseline: null, align: null };
  const resetTextState = () => { textState.font = textState.baseline = textState.align = null; };
  return {
    drawRect(o = {}) {
      const w = o.width || 0, h = o.height || 0;
      const [ox, oy] = anchorOrigin(o.anchor || "topleft");
      cDrawRect(ctx, {
        x: px(o.pos) - w * ox, y: py(o.pos) - h * oy, w, h,
        color: o.color, opacity: o.opacity ?? 1, radius: o.radius || 0, // color passed through (rgba handles KColor/array) — no per-draw toRGB array alloc
        fill: o.fill !== false, outline: outlineOf(o),
      });
    },
    drawCircle(o = {}) {
      cDrawCircle(ctx, {
        x: px(o.pos), y: py(o.pos), radius: o.radius || 0,
        color: o.color, opacity: o.opacity ?? 1, fill: o.fill !== false, outline: outlineOf(o),
      });
    },
    drawEllipse(o = {}) {
      cDrawEllipse(ctx, {
        x: px(o.pos), y: py(o.pos), radiusX: o.radiusX || 0, radiusY: o.radiusY || 0,
        color: o.color, opacity: o.opacity ?? 1,
      });
    },
    drawLine(o = {}) {
      cDrawLine(ctx, { p1: o.p1 || { x: 0, y: 0 }, p2: o.p2 || { x: 0, y: 0 }, width: o.width || 1, color: o.color, opacity: o.opacity ?? 1 });
    },
    drawText(o = {}) {
      const text = o.text == null ? "" : String(o.text);
      const size = o.size || 16, font = o.font || "sans-serif", anchor = o.anchor || "topleft";
      const width = o.width || 0;                       // k.drawText: o.width = wrap width
      const color = toRGB(o.color), opacity = o.opacity ?? 1;
      // TQ-443 (opt 2): single-line, non-wrapped labels blit from the bitmap cache (no font/fillStyle
      // parse). Wrapped/multi-line/empty text and metric-less environments fall through to direct draw.
      if (labelCache && width <= 0 && text && text.indexOf("\n") === -1 && ctx.getTransform) {
        const S = ctx.getTransform().a || 1;            // live device scale (vp.scale × dpr) — bake at it for crisp glyphs
        if (S > 0) {
          const rgbStr = `rgb(${color[0] | 0},${color[1] | 0},${color[2] | 0})`; // opacity applied at blit via globalAlpha
          const key = `${size}|${font}|${anchor}|${rgbStr}|${S.toFixed(3)}|${text}`;
          const e = labelCache.acquire({ key, text, size, font, anchor, rgbStr, scale: S });
          if (e && e.bmp) {
            const prevA = ctx.globalAlpha;
            ctx.globalAlpha = opacity;
            ctx.drawImage(e.bmp, px(o.pos) + e.offX, py(o.pos) + e.offY, e.wDesign, e.hDesign);
            ctx.globalAlpha = prevA;
            return;
          }
        }
      }
      cDrawText(ctx, { text, x: px(o.pos), y: py(o.pos), size, color, opacity, anchor, font, width }, textState);
    },
    drawPolygon(o = {}) {
      cDrawPoly(ctx, { points: o.pts || o.points || [], color: o.color, opacity: o.opacity ?? 1 });
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
        if (Array.isArray(v)) return _kcol(v[0] || 0, v[1] || 0, v[2] || 0);
        if (v && typeof v.r === "number") return v; // already a KColor — pass through (unchanged)
      }
      return _kcol(c[0] || 0, c[1] || 0, c[2] || 0);
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
      resetTextState(); // ctx.save/restore round-trips font/baseline/align — drop the stale shadow (TQ-443)
    },
    popClip() { ctx.restore(); resetTextState(); },
  };
}

// (TQ-341) The TQ-274 `drawRendererDemo` reference scene was removed as dead code — it proved the
// k.draw* → cDraw* adapter during the cutover spike and has no production caller now that the real
// scenes drive the adapter. The adapter itself (makeCanvasRenderer above) is exercised by every scene.
