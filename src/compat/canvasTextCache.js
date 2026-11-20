import { textAlignFor, textBaselineFor } from "./canvasBackend.js";

const DEFAULT_CAP = 512;
const DEFAULT_PROMOTE = 3;
const PAD = 2;
const MAX_W = 2048, MAX_H = 1024;

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
  const ox = aL + PAD, oy = aA + PAD;
  cctx.fillText(text, ox, oy);
  return { bmp: cv, wDesign: wPx / S, hDesign: hPx / S, offX: -ox / S, offY: -oy / S };
}

export function makeLabelCache({ cap = DEFAULT_CAP, promoteAfter = DEFAULT_PROMOTE, doc } = {}) {
  const document_ = doc !== undefined ? doc : (typeof document !== "undefined" ? document : null);
  const map = new Map();
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
    map.delete(key);
    map.set(key, entry);
    if (map.size > cap) { const oldest = map.keys().next().value; map.delete(oldest); }
  }
  return {
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
        e.unbakeable = true;
      }
      return null;
    },
    size() { return map.size; },
    clear() { map.clear(); },
  };
}
