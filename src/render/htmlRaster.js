// SECURITY: sanitize before wrapping in SVG; never raster raw markup.
import { sanitizeHtml, sanitizeHtmlModel } from "../systems/htmlSanitize.js";
import { HTML_CANVAS } from "../systems/htmlModel.js";

export function rasterizeHtmlModel(model, { size = 64, transparent = true } = {}) {
  return new Promise((resolve) => {
    if (!model || typeof document === "undefined" || typeof Image === "undefined") return resolve(null);
    const box = model.canvas || HTML_CANVAS;
    let base;
    if (transparent) { const m = sanitizeHtmlModel(model); base = m && m.base; }
    else { base = sanitizeHtml(typeof model.base === "string" ? model.base : ""); }
    if (!base || !/<[a-z]/i.test(base)) return resolve(null);
    // XHTML xmlns on the inner div is required for foreignObject.
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
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

export function hasHtmlVisual(model) {
  return !!(model && typeof model.base === "string" && model.base.trim().length > 0);
}
