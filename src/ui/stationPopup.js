// TQ-118 (epic TQ-99 / decision TQ-126 "true overlay"): a reusable IN-LOBBY STATION POPUP shell.
// A station (Bestiary, shop, cosmetics, settings…) opens as a centred panel OVER the dimmed-but-still-
// drawn village + HUD, instead of switching scenes — so the lobby never blanks. The HOST scene (hub.js)
// owns the open/close state and supplies a station's content via a render(k, rect)+onTap contract; this
// module draws the chrome (scrim + panel + title + Close[X]) and CLIPS the content to the panel body
// with the shim's k.pushClip/k.popClip (TQ-164), exposing geometry + hit-tests so the host can route
// taps / scroll / Esc. Siblings TQ-119/120/121 just supply different content.
import { THEME, drawPanel, drawButton, inRect } from "./theme.js";

const TITLE_H = 48, PAD = 14;

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
  return [px + PW - 42, py + 8, 32, 32];
}
export function stationPopupInside(k, p) {
  const { px, py, PW, PH } = stationPopupRect(k);
  return p.x >= px && p.x <= px + PW && p.y >= py && p.y <= py + PH;
}

/**
 * Draw the popup chrome + run the station content clipped to the panel body. Immediate-mode — call
 * every frame while open, AFTER the world/HUD (so it composites on top). Content MUST draw fixed.
 * @param {object} opts { title, content:(k,[x,y,w,h])=>void, pointer?:{x,y} }
 */
export function drawStationPopup(k, { title, content, pointer } = {}) {
  const { px, py, PW, PH } = stationPopupRect(k);
  const T = (n) => { const c = THEME[n] || [255, 255, 255]; return k.rgb(c[0], c[1], c[2]); };
  // Dim the village behind (it stays drawn — the lobby never blanks).
  k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(), color: k.rgb(0, 0, 0), opacity: 0.55, fixed: true });
  drawPanel(k, { rect: [px, py, PW, PH], radius: 16, fill: THEME.surface, border: THEME.primary, borderW: 2, fixed: true });
  // Title bar + divider.
  k.drawText({ text: title || "", pos: k.vec2(px + PAD + 2, py + 14), size: 20, font: "gameFont", color: T("text"), fixed: true });
  k.drawRect({ pos: k.vec2(px + PAD, py + TITLE_H - 2), width: PW - PAD * 2, height: 1, color: T("line"), fixed: true });
  // Close [X].
  const cr = stationCloseRect(k);
  drawButton(k, { rect: cr, text: "X", size: 16, fill: THEME.surfaceAlt, textColor: THEME.text, outline: THEME.line, hover: pointer ? inRect(pointer, cr) : false, fixed: true });
  // Content — clipped to the body so a scrolling grid can't spill past the panel (TQ-164).
  const rect = stationContentRect(k);
  k.pushClip(rect[0], rect[1], rect[2], rect[3]);
  try { if (content) content(k, rect); } finally { k.popClip(); }
}
