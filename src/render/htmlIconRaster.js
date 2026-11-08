// TQ-373: rasterize an html-model monster (the monster.html live-DOM visual used in the overworld /
// combat / detail popup) to a cached CANVAS, so the canvas ICON grids — roster Team/Vault cards, the
// bestiary, lobby team slots, the profile team — can show the AUTHORED creature instead of a blank /
// generic emblem. Those grids can't mount a live-DOM node per cell (pooling + scroll-clipping make that
// a much larger change), but a one-time raster of the SAME sanitized markup via an SVG <foreignObject>
// image renders the creature identically: the markup is pure inline-styled HTML/SVG with NO external
// refs (the sanitizer forbids url()/@import), so the resulting canvas is neither tainted nor blank
// (verified empirically in headless Chromium, tools/_tq373raster.mjs). One raster per type, cached; the
// icon path just blits the cached canvas via k.drawSprite({ image }). The animation is captured at its
// rest pose (a still image is correct for an icon).
//
// SECURITY: the markup goes through the TQ-261 sanitizer (sanitizeHtmlModel) before it is ever wrapped
// in the SVG — exactly like the live-DOM paths (htmlMonsterOverlay TQ-262, monsterDetailHtml TQ-309).
//
// GRACEFUL DEGRADATION: htmlIconImage returns null until (or unless) the raster is ready — the caller
// then draws its existing tinted-emblem fallback. If a browser can't rasterize a foreignObject image
// (onerror, or it never loads), the status stays non-ready forever and the icon simply keeps the
// emblem — i.e. the worst case is exactly today's behaviour, never worse.

import { getMonsterType } from "../engine/gamedata.js";
import { hasHtmlModel } from "../systems/htmlModel.js";
import { sanitizeHtmlModel } from "../systems/htmlSanitize.js";

// typeName -> { canvas: HTMLCanvasElement|null, status: "pending"|"ready"|"none", src: string }
const cache = new Map();

// Resolve the monster type by name and return its cached icon canvas, kicking off a one-time raster on
// first request. Returns the canvas only once it is fully drawn ("ready"); null otherwise (no DOM, no
// html model, sanitised-to-nothing, still loading, or unsupported) so the caller keeps its emblem.
export function htmlIconImage(typeName) {
  if (!typeName || typeof document === "undefined" || typeof Image === "undefined") return null;
  const mt = getMonsterType(typeName);
  if (!mt || !hasHtmlModel(mt)) return null;

  const ent = cache.get(typeName);
  if (ent && ent.src === mt.html) return ent.status === "ready" ? ent.canvas : null;
  // No entry yet, or the stored model changed (admin re-gen) → (re)rasterize.

  const model = sanitizeHtmlModel(mt.html);
  if (!model) { cache.set(typeName, { canvas: null, status: "none", src: mt.html }); return null; }
  const box = model.canvas || 256;
  const rec = { canvas: null, status: "pending", src: mt.html };
  cache.set(typeName, rec);

  // Wrap the sanitized base in an SVG foreignObject; the inner div is sized to the authored box so the
  // creature fills it. xmlns on the div is REQUIRED — foreignObject content must be in the XHTML ns.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${box}px;height:${box}px">${model.base}</div>` +
    `</foreignObject></svg>`;
  const img = new Image();
  // PERF: the SVG <foreignObject> is rasterized SYNCHRONOUSLY inside drawImage — the expensive part. A
  // grid that requests dozens of monsters at once (bestiary first open) used to get all its onloads in
  // the same frame and froze for seconds. Queue the finished loads and drain a few per animation frame
  // (the icon keeps its emblem until its raster lands), so the grid fills in smoothly instead of hanging.
  img.onload = () => enqueueRaster(() => {
    try {
      const cv = document.createElement("canvas");
      cv.width = box; cv.height = box;
      // willReadFrequently: a CPU-backed raster. The icon path scans the art's top row once (monster.js
      // artTopFrac) and that read-back stalled 10+ s on a GPU-backed canvas on phones. Measure it here,
      // while the pixels are already on the CPU, and hand it over on the canvas (cv._artTop).
      const g = cv.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0, box, box);
      cv._artTop = artTopOf(g, box, box);
      rec.canvas = cv; rec.status = "ready";
    } catch { rec.status = "none"; } // tainted / unsupported → keep the emblem
  });
  img.onerror = () => { rec.status = "none"; };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  return null;
}

// Topmost row with visible alpha, as a 0..1 fraction of the height (0.5 = "no shrink" when unreadable).
// Scans a 32-row stride for speed; the icon fit only needs coarse precision.
export function artTopOf(g, w, h) {
  try {
    const data = g.getImageData(0, 0, w, h).data;
    const step = Math.max(1, Math.floor(h / 64));
    for (let y = 0; y < h; y += step) { const row = y * w * 4; for (let x = 0; x < w; x += 2) { if (data[row + x * 4 + 3] > 16) return Math.max(0, Math.min(0.5, y / h)); } }
  } catch { /* tainted → no shrink */ }
  return 0.5;
}

// Per-frame raster budget: at most RASTERS_PER_FRAME foreignObject decodes per animation frame.
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

// Test/teardown aid — drop the raster cache (not needed in the running game).
export function _resetHtmlIconCache() { cache.clear(); }
