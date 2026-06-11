// One shared in-round HUD layout for BOTH the SP (game.js) and MP (onlineGame.js) scenes,
// so the two can't drift ("fix once"). Every cluster is placed in the GUTTERS outside the
// square play window — the world shows ONLY inside the square (drawPlayWindow occludes the
// rest), and the minimap / team overview / touch controls live in the surrounding UI space
// (user 2026-06-09).
//
// Adapts to orientation via playWindowLayout:
//   • landscape (gutters left/right): team + chain + objective + biome on the LEFT, timer +
//     minimap on the RIGHT; touch controls hug the bottom of each gutter.
//   • portrait (gutters top/bottom): team / timer / minimap / objective across the TOP,
//     chain + biome + touch controls across the BOTTOM.
//   • square aspect (no gutters): tuck onto the square edges (graceful fallback).
//
// All coordinates are SCREEN space (the scenes that draw in world space add the camera
// offset themselves). Pure; call per frame so it's resize/orientation-safe. `inset` carries
// the mobile safe-area insets (notch / home bar) in design units.

import { playWindowLayout } from "./playWindow.js";
import { minimapSize } from "./minimap.js";

// A gutter narrower/shorter than this can't usefully hold the HUD, so for near-square
// aspects (where the gutters are tiny) we fall back to tucking the HUD onto the square
// edges instead — better a slight overlap than HUD spilling past a 40px gutter.
const MIN_SIDE_GUTTER = 150; // landscape: min side-gutter width to host the HUD
const MIN_BAND_GUTTER = 120; // portrait: min top/bottom-band height to host the HUD

// Memoized: the viewport + safe-area insets are steady frame-to-frame, yet hudLayout
// is rebuilt ~9× per frame (every hudSlots() call), each rebuild allocating ~10 slot
// objects. Same inputs → same layout, so cache the last result keyed on (W,H,insets)
// (compared as scalars — no per-call key string) and deep-freeze it. Freezing makes
// the shared layout read-only: it documents the contract (every consumer only READS
// slot coords) and turns any accidental mutation into an immediate error instead of
// silent cross-call corruption.
let _kw = -1, _kh = -1, _kt = -1, _kb = -1, _kl = -1, _kr = -1, _hud = null;
function freezeLayout(o) {
  for (const key in o) { const v = o[key]; if (v && typeof v === "object") Object.freeze(v); } // freeze each slot (square is already frozen)
  return Object.freeze(o);
}
export function hudLayout(W, H, { inset = {} } = {}) {
  const it = (inset.top || 0), ib = (inset.bottom || 0), il = (inset.left || 0), ir = (inset.right || 0);
  if (W === _kw && H === _kh && it === _kt && ib === _kb && il === _kl && ir === _kr && _hud) return _hud;
  _hud = freezeLayout(computeHudLayout(W, H, it, ib, il, ir));
  _kw = W; _kh = H; _kt = it; _kb = ib; _kl = il; _kr = ir;
  return _hud;
}
function computeHudLayout(W, H, it, ib, il, ir) {
  const lay = playWindowLayout(W, H);
  const sq = lay.square;
  const baseMM = minimapSize(W, H);
  const pad = 12;

  if (lay.landscape && sq.x >= MIN_SIDE_GUTTER) {
    // Gutters left + right, each `gw` wide and full height.
    const gw = sq.x;
    const cxL = gw / 2, cxR = sq.right + gw / 2;
    const mm = Math.max(96, Math.min(baseMM, gw - 2 * pad));
    return {
      orientation: "landscape", square: sq, gutterW: gw, mmSize: mm,
      team:      { x: pad + il, y: pad + it },
      chain:     { x: pad + il, y: pad + it + 150 },
      objective: { x: cxL, y: sq.cy, width: gw - 2 * pad },
      biome:     { x: cxL, y: H - pad - 14 - ib },
      timer:     { x: cxR, y: pad + it + 16 },
      minimap:   { x: cxR - mm / 2, y: pad + it + 42, size: mm },
      // touch controls (used on a landscape phone): bottom of each gutter
      joystick:  { x: cxL, y: H - ib - 96 },
      throwBtn:  { x: cxR, y: H - ib - 84 },
      pause:     { x: W - ir - pad - 44, y: pad + it, w: 44, h: 34 },
    };
  }

  if (lay.portrait && sq.y >= MIN_BAND_GUTTER) {
    // Gutters top + bottom; top is `sq.y` tall, bottom is `H - sq.bottom` tall.
    const bh = H - sq.bottom;
    const mm = Math.max(96, Math.min(baseMM, sq.y - 2 * pad, 150));
    const rowH = Math.max(112, mm); // height of the team/minimap row in the top gutter
    return {
      orientation: "portrait", square: sq, gutterH: sq.y, mmSize: mm,
      team:      { x: pad + il, y: pad + it },
      timer:     { x: sq.cx, y: pad + it + 12 },
      minimap:   { x: W - mm - pad - ir, y: pad + it, size: mm },
      // Objective as a subtitle on the square's bottom inside edge. The top gutter can't
      // hold info(3 lines) + a 4-monster team + the objective, so the old top-gutter slot
      // (y≈rowH) crossed the team's lower HP bars. The bottom inside edge clears both the
      // top-gutter team and the bottom-gutter chain/biome/touch controls.
      objective: { x: sq.cx, y: sq.bottom - 24, width: sq.size - 24 },
      chain:     { x: pad + il, y: sq.bottom + 8 },
      biome:     { x: sq.cx, y: sq.bottom + bh - 16 },
      joystick:  { x: sq.x + 84 + il, y: sq.bottom + bh / 2 + 4 },
      throwBtn:  { x: W - ir - 56, y: sq.bottom + bh / 2 + 4 },
      pause:     { x: W - ir - pad - 44, y: sq.bottom + pad, w: 44, h: 34 },
    };
  }

  // Square aspect: no gutters — tuck onto the square edges so nothing is lost.
  const mm = baseMM;
  return {
    orientation: "square", square: sq, gutterW: 0, mmSize: mm,
    team:      { x: sq.x + pad, y: sq.y + pad },
    chain:     { x: sq.x + pad, y: sq.bottom - 64 },
    timer:     { x: sq.cx, y: sq.y + 22 },
    // Centered at the top — width must clear the top corners (team left, minimap right) so a long
    // objective doesn't run into the minimap. The minimap (mm+pad) is the wider corner; reserve it
    // on BOTH sides since the text is centered. Long objectives then wrap to 2 lines instead.
    objective: { x: sq.cx, y: sq.y + 52, width: Math.max(180, sq.size - 2 * (mm + pad + 8)) },
    // Lifted clear of the bottom controls hint: in the square aspect the hint is shown
    // (onlineGame: hint only renders when orientation==="square") as a full-width line at
    // sq.bottom-24, and the centered biome chip at -28 was drawn right on top of its
    // "Cycle chain: [ ]" text. -52 clears it (chain HUD is bottom-LEFT, so no clash there).
    biome:     { x: sq.cx, y: sq.bottom - 52 },
    minimap:   { x: sq.right - mm - pad, y: sq.y + pad, size: mm },
    joystick:  { x: sq.x + 90, y: sq.bottom - 90 },
    throwBtn:  { x: sq.right - 70, y: sq.bottom - 70 },
    // BELOW the minimap (not the top-right corner): in the square fallback the minimap occupies
    // that corner, so the top-right pause drew INSIDE it (visible on 4:3 touch tablets / iPad,
    // which use this branch). Tuck it just under the radar on the right edge.
    pause:     { x: sq.right - pad - 44, y: sq.y + pad + mm + 8, w: 44, h: 34 },
  };
}
