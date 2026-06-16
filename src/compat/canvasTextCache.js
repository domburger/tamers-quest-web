// TQ-443 (opt 2 of the cDrawText hot-path fix): a glyph/label texture cache. TQ-336 measured cDrawText
// as ~22% per-frame self-time, dominated by the canvas STYLE-SETTER parse (ctx.font re-parses the
// shorthand string, ctx.fillStyle re-parses the colour) on EVERY text draw — native fillText is ~1%.
// The style-guard (canvasBackend.cDrawText `state`) cuts the font re-parse for runs of same-size text,
// but the real win for repeated labels (nameplates, HUD labels, button captions, biome chip) is to bake
// each unique (text+size+font+colour+anchor) once to an offscreen canvas and blit it with drawImage
// thereafter — drawImage parses no styles, so a cached label costs ~one bitmap blit, not a font parse +
// fillText layout.
//
// Correctness: the bitmap is positioned PIXEL-EXACTLY against the direct fillText path. We measure the
// text with the SAME font/textAlign/textBaseline the direct path uses (textAlignFor/textBaselineFor) and
// read measureText's actualBoundingBox* metrics — those are relative to the fillText anchor point (which
// IS the draw's (x,y)), so baking the ink at a known origin and blitting that origin onto (x,y)
// reproduces the exact glyph placement for any anchor. Bitmaps are rendered at device resolution
// (scale = the live ctx x-scale, vp.scale×dpr) and drawn back at design size → 1:1, crisp.
//
// Thrash guard: a label is only baked after it has been requested `promoteAfter` frames — text that
// changes every frame (timers, HP counts) gets a fresh key each frame, never reaches the threshold, and
// stays on the direct path (no per-frame canvas allocation). The cache is LRU-capped; stable labels are
// touched every frame so they stay hot, dynamic keys fall to the tail and evict first.
import { textAlignFor, textBaselineFor } from "./canvasBackend.js";

const DEFAULT_CAP = 512;     // max distinct baked/tracked labels (each bmp is a small canvas)
const DEFAULT_PROMOTE = 3;   // frames a label must recur before it's baked (skips one-shot/dynamic text)
const PAD = 2;               // device-px guard so antialiased glyph edges aren't clipped
const MAX_W = 2048, MAX_H = 1024; // sanity bounds — refuse to bake absurd bitmaps (fall back to direct)

// Bake one label to an offscreen canvas. Returns { bmp, wDesign, hDesign, offX, offY } (offsets/dims in
// DESIGN units; bmp is device px) or null when the environment can't bake (no DOM / no bbox metrics).
function bake(doc, mctx, { text, size, font, anchor, rgbStr, scale }) {
  if (!doc || !mctx) return null;
  const S = scale > 0 ? scale : 1;
  const fpx = size * S;
  if (!(fpx > 0)) return null;
  const align = textAlignFor(anchor), baseline = textBaselineFor(anchor);
  mctx.font = `${fpx}px ${font}`;
  mctx.textAlign = align;
  mctx.textBaseline = baseline;
  const m = mctx.measureText(text);
  const aL = m.actualBoundingBoxLeft, aR = m.actualBoundingBoxRight;
  const aA = m.actualBoundingBoxAscent, aD = m.actualBoundingBoxDescent;
  // No actualBoundingBox* support → can't place exactly; bail to the direct path.
  if (![aL, aR, aA, aD].every((v) => typeof v === "number" && isFinite(v))) return null;
  const wPx = Math.ceil(aL + aR) + PAD * 2;
  const hPx = Math.ceil(aA + aD) + PAD * 2;
  if (!(wPx > 0 && hPx > 0) || wPx > MAX_W || hPx > MAX_H) return null;
  let cv;
  try { cv = doc.createElement("canvas"); } catch { return null; }
  cv.width = wPx; cv.height = hPx;
  const cctx = cv.getContext && cv.getContext("2d");
  if (!cctx) return null;
  cctx.font = `${fpx}px ${font}`;
  cctx.textAlign = align;
  cctx.textBaseline = baseline;
  cctx.fillStyle = rgbStr;
  // Origin inside the bitmap (device px) where the draw's (x,y) maps: ink extends aL/aA up-left of it,
  // so placing the origin at (aL+PAD, aA+PAD) keeps the whole glyph block inside with PAD to spare.
  const ox = aL + PAD, oy = aA + PAD;
  cctx.fillText(text, ox, oy);
  // Blitting at (x+offX, y+offY) with dest size (wPx/S, hPx/S) puts the origin exactly on (x,y).
  return { bmp: cv, wDesign: wPx / S, hDesign: hPx / S, offX: -ox / S, offY: -oy / S };
}

/**
 * Build a label texture cache. Pure construction; `doc` defaults to the live `document` (null in Node,
 * which disables baking — callers then render text directly). Tests inject a fake `doc`.
 * @returns {{acquire(spec):object|null, size():number, clear():void}}
 */
export function makeLabelCache({ cap = DEFAULT_CAP, promoteAfter = DEFAULT_PROMOTE, doc } = {}) {
  const document_ = doc !== undefined ? doc : (typeof document !== "undefined" ? document : null);
  const map = new Map(); // key -> { hits, bmp, wDesign, hDesign, offX, offY, unbakeable }
  let scratch = null, scratchTried = false;
  function scratchCtx() {
    if (scratchTried) return scratch;
    scratchTried = true;
    if (!document_) return (scratch = null);
    try { const c = document_.createElement("canvas"); c.width = c.height = 8; scratch = (c.getContext && c.getContext("2d")) || null; }
    catch { scratch = null; }
    return scratch;
  }
  function touch(key, entry) {
    map.delete(key);            // re-insert at the tail so Map iteration order tracks LRU recency
    map.set(key, entry);
    if (map.size > cap) { const oldest = map.keys().next().value; map.delete(oldest); }
  }
  return {
    /**
     * Request a baked label for `spec` ({key,text,size,font,anchor,rgbStr,scale}). Returns the cache
     * entry (with a `.bmp` ready to blit) once the label has recurred enough to be baked; returns null
     * while it's still being counted or can't be baked — the caller renders directly that frame.
     */
    acquire(spec) {
      const key = spec.key;
      let e = map.get(key);
      if (e && e.bmp) { touch(key, e); return e; }
      if (e && e.unbakeable) { touch(key, e); return null; }
      if (!e) e = { hits: 0, bmp: null };
      e.hits++;
      touch(key, e);
      if (e.hits >= promoteAfter) {
        const built = bake(document_, scratchCtx(), spec);
        if (built) { Object.assign(e, built); return e; }
        e.unbakeable = true; // metrics/DOM unavailable — stop retrying every frame
      }
      return null;
    },
    size() { return map.size; },
    clear() { map.clear(); },
  };
}
