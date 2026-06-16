// TQ-393: rasterize a free-form HTML/CSS visual model ({canvas, base} — the same shape monster.html
// uses, authored now for ITEMS and TILES too) into a CANVAS, via an SVG <foreignObject> image. This is
// the shared, generalised version of the monster icon raster (src/render/htmlIconRaster.js, TQ-373):
// the canvas ICON grids (roster Items) and the canvas tile TEXTURE can't mount a live-DOM node per cell,
// but a one-time raster of the SAME sanitized markup renders it identically — the markup is pure
// inline-styled HTML/SVG with NO external refs (the sanitizer forbids url()/@import), so the resulting
// canvas is neither tainted nor blank. The animation (if any) is captured at its rest pose, which is
// correct for a still icon / baked tile.
//
// SECURITY: the markup goes through the TQ-261 default-deny sanitizer (htmlSanitize.js) BEFORE it is ever
// wrapped in the SVG — exactly like the live-DOM paths and the monster icon raster.
//
// GRACEFUL: resolves null on ANY failure (no DOM/Image, sanitises to nothing, taint, or load error) so
// the caller keeps its existing fallback (item text card / procedural tile grain) — never worse than before.
import { sanitizeHtml, sanitizeHtmlModel } from "../systems/htmlSanitize.js";
import { HTML_CANVAS } from "../systems/htmlModel.js";

// model: { canvas, base } (an item.html / tile.html). Options:
//   size        — the output canvas edge in px (the authored `canvas` box is scaled to it).
//   transparent — true (ICONS, e.g. items): strip the root element's background so the icon drops onto
//                 any slot (sanitizeHtmlModel, which also strips the root bg, like monsters). false
//                 (TILES): keep the authored full-bleed ground fill (sanitizeHtml only, no bg strip).
export function rasterizeHtmlModel(model, { size = 64, transparent = true } = {}) {
  return new Promise((resolve) => {
    if (!model || typeof document === "undefined" || typeof Image === "undefined") return resolve(null);
    const box = model.canvas || HTML_CANVAS;
    let base;
    if (transparent) { const m = sanitizeHtmlModel(model); base = m && m.base; }
    else { base = sanitizeHtml(typeof model.base === "string" ? model.base : ""); }
    if (!base || !/<[a-z]/i.test(base)) return resolve(null);
    // xmlns on the inner div is REQUIRED — foreignObject content must be in the XHTML namespace.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}">` +
      `<foreignObject width="100%" height="100%">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${box}px;height:${box}px">${base}</div>` +
      `</foreignObject></svg>`;
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement("canvas");
        cv.width = size; cv.height = size;
        cv.getContext("2d").drawImage(img, 0, 0, size, size);
        resolve(cv);
      } catch { resolve(null); } // tainted / unsupported → keep the fallback
    };
    img.onerror = () => resolve(null);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

// True when a visual model carries renderable authored markup (a non-empty base string).
export function hasHtmlVisual(model) {
  return !!(model && typeof model.base === "string" && model.base.trim().length > 0);
}
