// TQ-118 (epic TQ-99 / decision TQ-126 "true overlay"): a reusable IN-LOBBY STATION POPUP shell.
// A station (Bestiary, shop, cosmetics, settings…) opens as a centred panel OVER the dimmed-but-still-
// drawn village + HUD, instead of switching scenes — so the lobby never blanks. The HOST scene (hub.js)
// owns the open/close state and supplies a station's content via a render(k, rect)+onTap contract; this
// module draws the chrome (scrim + panel + title + Close[X]) and CLIPS the content to the panel body
// with the shim's k.pushClip/k.popClip (TQ-164), exposing geometry + hit-tests so the host can route
// taps / scroll / Esc. Siblings TQ-119/120/121 just supply different content.
//
// Design upgrade (2026-11): vignette scrim, a top-lit gradient panel with a soft blurred shadow, a
// header band with an ornamental ember rule under the title, and a drawn-cross close button.
import { THEME, FONT_BOLD, drawPanel, drawCloseX, drawOrnamentRule, inRect, lighten } from "./theme.js";

const TITLE_H = 52, PAD = 14;

// Centred panel rect for the current viewport (responsive: near-full on narrow/portrait).
export function stationPopupRect(k) {
  const W = k.width(), H = k.height();
  const narrow = W < 560;
  const PW = Math.min(narrow ? W - 20 : 760, W - 24);
  const PH = Math.min(narrow ? H - 40 : 560, H - 32);
  return { px: (W - PW) / 2, py: (H - PH) / 2, PW, PH, narrow };
}

// The content area (below the title bar, inside padding) — where the station draws + scrolls.
export function stationContentRect(k) {
  const { px, py, PW, PH } = stationPopupRect(k);
  return [px + PAD, py + TITLE_H, PW - PAD * 2, PH - TITLE_H - PAD];
}
export function stationCloseRect(k) {
  const { px, py, PW } = stationPopupRect(k);
  return [px + PW - 46, py + 9, 34, 34];
}
export function stationPopupInside(k, p) {
  const { px, py, PW, PH } = stationPopupRect(k);
  return p.x >= px && p.x <= px + PW && p.y >= py && p.y <= py + PH;
}

/**
 * Draw the popup chrome + the station's content (clipped to the body).
 * @param k           compat ctx (fixed/screen-space draws)
 * @param {string}    title    station title
 * @param {Function}  content  (k, contentRect) → draws the station body inside the clip
 * @param {{x,y}}     pointer  current pointer (design coords) for hover states; optional
 */
export function drawStationPopup(k, { title, content, pointer, openedT = null } = {}) {
  const { px, py, PW, PH } = stationPopupRect(k);
  const T = (n) => { const c = THEME[n] || [255, 255, 255]; return k.rgb(c[0], c[1], c[2]); };
  // TQ-555: pop-in. For the first ~0.2s after `openedT` (scene time) the chrome fades in and rises a few px;
  // the clipped content appears once the panel is mostly in so nothing draws outside the rising frame.
  const age = openedT != null && typeof k.time === "function" ? Math.max(0, k.time() - openedT) : 1;
  const p = Math.min(1, age / 0.2), e = 1 - (1 - p) * (1 - p), dy = (1 - e) * 12;
  // Dim the village behind (it stays drawn — the lobby never blanks). A flat scrim: the radial vignette
  // version cost ~9ms/frame of software raster (tools/qa-bench.mjs) for a subtle gain.
  k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: 0.62 * e, fixed: true });
  drawPanel(k, { rect: [px, py + dy, PW, PH], radius: 18, fill: THEME.surface, border: THEME.lineHi, borderW: 1.5, opacity: e, fixed: true });
  // Header band: a slightly lifted strip under the title that fades into the body.
  k.drawRect({ pos: k.vec2(px + 1, py + dy + 1), width: PW - 2, height: TITLE_H + 10, radius: 17, color: T("surface2"), opacity: e,
    gradient: { dir: "v", stops: [[0, lighten(THEME.surface2, 6), 0.9], [1, THEME.surface2, 0]] }, fixed: true });
  k.drawText({ text: title || "", pos: k.vec2(px + PAD + 4, py + dy + 15), size: 22, font: FONT_BOLD, color: T("text"), opacity: e, fixed: true });
  drawOrnamentRule(k, { x: px + PAD + 4, y: py + dy + TITLE_H - 6, w: Math.min(220, PW * 0.4), fixed: true });
  k.drawRect({ pos: k.vec2(px + PAD, py + dy + TITLE_H - 2), width: PW - PAD * 2, height: 1, color: T("lineSoft"), opacity: e, fixed: true });
  // Close [X] — a round ghost button with a drawn cross.
  const cr = stationCloseRect(k);
  drawCloseX(k, { rect: [cr[0], cr[1] + dy, cr[2], cr[3]], hover: pointer ? inRect(pointer, cr) : false, fixed: true });
  // Content — clipped to the body so a scrolling grid can't spill past the panel (TQ-164).
  if (p < 0.5) return; // still popping in — content lands on the next frames
  const rect = stationContentRect(k);
  k.pushClip(rect[0], rect[1], rect[2], rect[3]);
  try { if (content) content(k, rect); } finally { k.popClip(); }
}
