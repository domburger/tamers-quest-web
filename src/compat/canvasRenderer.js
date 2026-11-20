import { cDrawRect, cDrawCircle, cDrawEllipse, cDrawLine, cDrawText, cDrawPoly } from "./canvasBackend.js";

const ANCHORS = {
  topleft: [0, 0], top: [0.5, 0], topright: [1, 0],
  left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
  botleft: [0, 1], bottomleft: [0, 1], bot: [0.5, 1], bottom: [0.5, 1],
  botright: [1, 1], bottomright: [1, 1],
};
export function anchorOrigin(anchor) { return ANCHORS[anchor] || ANCHORS.topleft; }

export function toRGB(color) {
  if (color && typeof color.r === "number" && typeof color.g === "number" && typeof color.b === "number") {
    return [color.r, color.g, color.b];
  }
  if (Array.isArray(color)) return color;
  return [255, 255, 255];
}

const px = (p) => (p && typeof p.x === "number" ? p.x : 0);
const py = (p) => (p && typeof p.y === "number" ? p.y : 0);

// Returns shared cached objects: never mutate a colour's channels.
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
const outlineOf = (o) => (o && o.outline ? { width: o.outline.width || 1, color: o.outline.color } : null);

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

export function makeCanvasRenderer(ctx, { textures, labelCache, frost = null, designW = 0, designH = 0 } = {}) {
  const drawStyle = { font: null, baseline: null, align: null, fill: null, stroke: null };
  const resetDrawStyle = () => { drawStyle.font = drawStyle.baseline = drawStyle.align = drawStyle.fill = drawStyle.stroke = null; };
  return {
    drawRect(o = {}) {
      const w = o.width || 0, h = o.height || 0;
      const [ox, oy] = anchorOrigin(o.anchor || "topleft");
      cDrawRect(ctx, {
        x: px(o.pos) - w * ox, y: py(o.pos) - h * oy, w, h,
        color: o.color, opacity: o.opacity ?? 1, radius: o.radius || 0,
        fill: o.fill !== false, outline: outlineOf(o),
        gradient: o.gradient || null, shadow: o.shadow || null,
      }, drawStyle);
    },
    drawCircle(o = {}) {
      cDrawCircle(ctx, {
        x: px(o.pos), y: py(o.pos), radius: o.radius || 0,
        color: o.color, opacity: o.opacity ?? 1, fill: o.fill !== false, outline: outlineOf(o),
        gradient: o.gradient || null,
      }, drawStyle);
    },
    drawEllipse(o = {}) {
      cDrawEllipse(ctx, {
        x: px(o.pos), y: py(o.pos), radiusX: o.radiusX || 0, radiusY: o.radiusY || 0,
        color: o.color, opacity: o.opacity ?? 1, gradient: o.gradient || null,
      }, drawStyle);
    },
    drawLine(o = {}) {
      cDrawLine(ctx, { p1: o.p1 || { x: 0, y: 0 }, p2: o.p2 || { x: 0, y: 0 }, width: o.width || 1, color: o.color, opacity: o.opacity ?? 1 }, drawStyle);
    },
    drawText(o = {}) {
      const text = o.text == null ? "" : String(o.text);
      const size = o.size || 16, font = o.font || "sans-serif", anchor = o.anchor || "topleft";
      const width = o.width || 0;
      const color = toRGB(o.color), opacity = o.opacity ?? 1;
      if (labelCache && width <= 0 && text && text.indexOf("\n") === -1 && ctx.getTransform) {
        const S = ctx.getTransform().a || 1;
        if (S > 0) {
          const rgbStr = `rgb(${color[0] | 0},${color[1] | 0},${color[2] | 0})`;
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
      cDrawText(ctx, { text, x: px(o.pos), y: py(o.pos), size, color, opacity, anchor, font, width }, drawStyle);
    },
    drawPolygon(o = {}) {
      cDrawPoly(ctx, { points: o.pts || o.points || [], color: o.color, opacity: o.opacity ?? 1 }, drawStyle);
    },
    drawSprite(o = {}) {
      const image = o.image || (textures && o.sprite != null ? textures.get(o.sprite) : null);
      if (!image) return;
      cDrawSprite(ctx, {
        image, x: px(o.pos), y: py(o.pos), width: o.width, height: o.height,
        scale: o.scale ?? 1, angle: o.angle || 0, anchor: o.anchor || "topleft", opacity: o.opacity ?? 1,
      });
    },
    rgb(...c) {
      if (c.length === 1) {
        const v = c[0];
        if (Array.isArray(v)) return _kcol(v[0] || 0, v[1] || 0, v[2] || 0);
        if (v && typeof v.r === "number") return v;
      }
      return _kcol(c[0] || 0, c[1] || 0, c[2] || 0);
    },
    vec2(x = 0, y = 0) { return { x, y }; },
    pushClip(x = 0, y = 0, w = 0, h = 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      resetDrawStyle(); // ctx save/restore changes styles: drop the style shadow.
    },
    popClip() { ctx.restore(); resetDrawStyle(); },
    drawFrost(o = {}) {
      if (!frost || !frost.ready || !frost.canvas || !(designW > 0 && designH > 0)) return false;
      const x = px(o.pos), y = py(o.pos), w = o.width || 0, h = o.height || 0, r = Math.min(o.radius || 0, w / 2, h / 2);
      ctx.save();
      ctx.beginPath();
      if (r > 0) { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
      else ctx.rect(x, y, w, h);
      ctx.clip();
      const prevA = ctx.globalAlpha;
      ctx.globalAlpha = o.opacity ?? 1;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(frost.canvas, 0, 0, frost.canvas.width, frost.canvas.height, 0, 0, designW, designH);
      ctx.globalAlpha = prevA;
      ctx.restore();
      resetDrawStyle();
      return true;
    },
    measureText(text, size = 16, font = "sans-serif") {
      const f = `${size}px ${font}`;
      if (drawStyle.font !== f) { ctx.font = f; drawStyle.font = f; }
      try { return ctx.measureText(String(text == null ? "" : text)).width; } catch { return String(text || "").length * size * 0.56; }
    },
  };
}

