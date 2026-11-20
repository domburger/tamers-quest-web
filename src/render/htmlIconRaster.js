// SECURITY: sanitizeHtmlModel before wrapping in SVG; never raster raw markup.

import { getMonsterType } from "../engine/gamedata.js";
import { hasHtmlModel } from "../systems/htmlModel.js";
import { sanitizeHtmlModel } from "../systems/htmlSanitize.js";

const cache = new Map();

export function htmlIconImage(typeName) {
  if (!typeName || typeof document === "undefined" || typeof Image === "undefined") return null;
  const mt = getMonsterType(typeName);
  if (!mt || !hasHtmlModel(mt)) return null;

  const ent = cache.get(typeName);
  if (ent && ent.src === mt.html) return ent.status === "ready" ? ent.canvas : null;

  const model = sanitizeHtmlModel(mt.html);
  if (!model) { cache.set(typeName, { canvas: null, status: "none", src: mt.html }); return null; }
  const box = model.canvas || 256;
  const rec = { canvas: null, status: "pending", src: mt.html };
  cache.set(typeName, rec);

  // XML-parsed: inner div needs XHTML xmlns and each inner <svg> needs SVG xmlns or nothing draws.
  const inner = model.base.replace(/<svg(?=[\s>])/g, '<svg xmlns="http://www.w3.org/2000/svg"');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${box}px;height:${box}px">${inner}</div>` +
    `</foreignObject></svg>`;
  const img = new Image();
  // drawImage rasterizes foreignObject synchronously; keep the per-frame queue.
  img.onload = () => enqueueRaster(() => {
    try {
      const cv = document.createElement("canvas");
      cv.width = box; cv.height = box;
      // willReadFrequently: GPU-backed pixel read-back stalls 10s+ on phones.
      const g = cv.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0, box, box);
      cv._artTop = artTopOf(g, box, box);
      rec.canvas = cv; rec.status = "ready";
    } catch { rec.status = "none"; }
  });
  img.onerror = () => { rec.status = "none"; };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  return null;
}

export function artTopOf(g, w, h) {
  try {
    const data = g.getImageData(0, 0, w, h).data;
    const step = Math.max(1, Math.floor(h / 64));
    for (let y = 0; y < h; y += step) { const row = y * w * 4; for (let x = 0; x < w; x += 2) { if (data[row + x * 4 + 3] > 16) return Math.max(0, Math.min(0.5, y / h)); } }
  } catch {}
  return 0.5;
}

const RASTERS_PER_FRAME = 2;
const rasterQueue = [];
let pumpArmed = false;
function enqueueRaster(job) {
  rasterQueue.push(job);
  if (pumpArmed) return;
  pumpArmed = true;
  const pump = () => {
    for (let n = 0; n < RASTERS_PER_FRAME && rasterQueue.length; n++) rasterQueue.shift()();
    if (rasterQueue.length) (typeof requestAnimationFrame === "function" ? requestAnimationFrame : (f) => setTimeout(f, 16))(pump);
    else pumpArmed = false;
  };
  (typeof requestAnimationFrame === "function" ? requestAnimationFrame : (f) => setTimeout(f, 16))(pump);
}

