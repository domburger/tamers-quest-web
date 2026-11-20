import { playWindowLayout } from "./playWindow.js";
import { minimapSize } from "./minimap.js";

const MIN_SIDE_GUTTER = 150;
const MIN_BAND_GUTTER = 120;

let _kw = -1, _kh = -1, _kt = -1, _kb = -1, _kl = -1, _kr = -1, _ka = -1, _kt2 = false, _hud = null;
function freezeLayout(o) {
  for (const key in o) { const v = o[key]; if (v && typeof v === "object") Object.freeze(v); }
  return Object.freeze(o);
}
// maxAspect must match the drawPlayWindow value for the same scene.
export function hudLayout(W, H, { inset = {}, maxAspect = 1, touch = false } = {}) {
  const it = (inset.top || 0), ib = (inset.bottom || 0), il = (inset.left || 0), ir = (inset.right || 0);
  if (W === _kw && H === _kh && it === _kt && ib === _kb && il === _kl && ir === _kr && maxAspect === _ka && touch === _kt2 && _hud) return _hud;
  _hud = freezeLayout(computeHudLayout(W, H, it, ib, il, ir, maxAspect, touch));
  _kw = W; _kh = H; _kt = it; _kb = ib; _kl = il; _kr = ir; _ka = maxAspect; _kt2 = touch;
  return _hud;
}
function computeHudLayout(W, H, it, ib, il, ir, maxAspect, touch = false) {
  const lay = playWindowLayout(W, H, { maxAspect });
  const sq = lay.square;
  const baseMM = minimapSize(W, H);
  const pad = 12;

  if (lay.landscape && sq.x >= MIN_SIDE_GUTTER) {
    const gw = sq.x;
    const cxL = gw / 2, cxR = sq.right + gw / 2;
    const mm = Math.max(96, Math.min(baseMM, gw - 2 * pad));
    return {
      orientation: "landscape", square: sq, gutterW: gw, mmSize: mm,
      team:      { x: pad + il, y: pad + it },
      chain:     { x: pad + il, y: pad + it + 150 },
      objective: { x: cxL, y: sq.cy, width: gw - 2 * pad },
      biome:     touch ? { x: cxR, y: H - ib - 84 - 84 - 74 } : { x: cxL, y: H - pad - 14 - ib },
      timer:     { x: cxR, y: pad + it + 16 },
      minimap:   { x: cxR - mm / 2, y: pad + it + 42, size: mm },
      joystick:  { x: cxL, y: H - ib - 96 },
      throwBtn:  { x: cxR, y: H - ib - 84 },
      swapBtn:   { x: cxR, y: H - ib - 84 - 84 },
      pause:     { x: W - ir - pad - 44, y: pad + it, w: 44, h: 34 },
    };
  }

  if (lay.portrait && sq.y >= MIN_BAND_GUTTER) {
    const bh = H - sq.bottom;
    const mm = Math.max(96, Math.min(baseMM, sq.y - 2 * pad, 150));
    return {
      orientation: "portrait", square: sq, gutterH: sq.y, mmSize: mm,
      team:      { x: pad + il, y: pad + it },
      timer:     { x: sq.cx, y: pad + it + 12 },
      minimap:   { x: W - mm - pad - ir, y: pad + it, size: mm },
      objective: { x: sq.cx, y: sq.bottom - 24, width: sq.size - 24 },
      chain:     { x: pad + il, y: sq.bottom + 8 },
      biome:     { x: sq.cx, y: sq.bottom + bh - 16 },
      joystick:  { x: sq.x + 84 + il, y: sq.bottom + bh / 2 + 4 },
      throwBtn:  { x: W - ir - 56, y: sq.bottom + bh / 2 + 4 },
      swapBtn:   { x: W - ir - 56 - 86, y: sq.bottom + bh / 2 + 4 },
      pause:     { x: W - ir - pad - 44, y: sq.bottom + pad, w: 44, h: 34 },
    };
  }

  const mm = baseMM;
  const sx = Math.max(sq.x, il), sy = Math.max(sq.y, it), sr = Math.min(sq.right, W - ir), sb = Math.min(sq.bottom, H - ib);
  return {
    orientation: "square", square: sq, gutterW: 0, mmSize: mm,
    team:      { x: sx + pad, y: sy + pad },
    chain:     { x: sx + pad, y: sb - 64 },
    timer:     { x: sq.cx, y: sy + 22 },
    objective: { x: sq.cx, y: sy + 52, width: Math.max(180, sq.size - 2 * (mm + pad + 8)) },
    biome:     { x: sq.cx, y: sb - 52 },
    minimap:   { x: sr - mm - pad, y: sy + pad, size: mm },
    joystick:  { x: sx + 90, y: sb - 90 },
    throwBtn:  { x: sr - 70, y: sb - 70 },
    swapBtn:   { x: sr - 70, y: sb - 70 - 80 },

    pause:     { x: sr - pad - 44, y: sy + pad + mm + 8, w: 44, h: 34 },
  };
}
