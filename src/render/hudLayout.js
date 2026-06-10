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

export function hudLayout(W, H, { inset = {} } = {}) {
  const it = (inset.top || 0), ib = (inset.bottom || 0), il = (inset.left || 0), ir = (inset.right || 0);
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
    objective: { x: sq.cx, y: sq.y + 52, width: sq.size - 160 },
    biome:     { x: sq.cx, y: sq.bottom - 28 },
    minimap:   { x: sq.right - mm - pad, y: sq.y + pad, size: mm },
    joystick:  { x: sq.x + 90, y: sq.bottom - 90 },
    throwBtn:  { x: sq.right - 70, y: sq.bottom - 70 },
    pause:     { x: sq.right - pad - 44, y: sq.y + pad, w: 44, h: 34 },
  };
}
