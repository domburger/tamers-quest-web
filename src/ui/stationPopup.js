import { THEME, FONT_BOLD, GLASS, WHITE, TYPE, drawEyebrow, drawHairline, drawGlass, drawCloseX, drawIconTab, drawCornerTicks, drawMotes, drawSweep, entranceDy, inRect } from "./theme.js";

export function drawGlassSheet(k, { rect, radius = 22, opacity = 1, accent = null, ticks = true } = {}) {
  const [x, y, w, h] = rect;
  const col = (t) => k.rgb(...t);
  const prevAccent = currentAccent; currentAccent = accent || THEME.primary;
  k.drawRect({ pos: k.vec2(x - 6, y + 4), width: w + 12, height: h + 10, radius: radius + 6, color: col(THEME.bgAlt), opacity: 0.2 * opacity, fixed: true });
  k.drawRect({ pos: k.vec2(x + 2, y + 6), width: w - 4, height: h + 2, radius, color: col(THEME.bgAlt), opacity: 0.3 * opacity, fixed: true });
  drawSheetBody(k, x, y, w, h, radius, opacity);
  if (accent) k.drawRect({ pos: k.vec2(x + 1, y + 1), width: w - 2, height: h - 2, radius: radius - 1, color: col(accent), opacity,
    gradient: { dir: "radial", cx: 0.2, cy: 0.1, r: Math.max(w, h) * 0.6, stops: [[0, accent, 0.18], [0.5, accent, 0.04], [1, accent, 0]] }, fixed: true });
  k.drawRect({ pos: k.vec2(x + 0.5, y + 0.5), width: w - 1, height: h - 1, radius: radius - 0.5, color: col(WHITE), opacity: 0.12 * opacity, fill: false, outline: { width: 1, color: col(WHITE) }, fixed: true });
  k.drawRect({ pos: k.vec2(x + radius, y + 1), width: w - radius * 2, height: 1, color: col(WHITE), opacity: 0.22 * opacity, fixed: true });
  if (ticks && accent) drawCornerTicks(k, { rect, color: accent, opacity: 0.5 * opacity, inset: 10, len: 10, fixed: true });
  currentAccent = prevAccent;
}

const PAD_W = 24, PAD_N = 12;
const HEAD_W = 98, HEAD_N = 78;
let currentAccent = null, currentOpenedT = null;
export function sheetEntrance(k, i, opts) { return entranceDy(k, currentOpenedT, i, opts); }
export function sheetAccent() { return currentAccent || THEME.primary; }

export function stationPopupRect(k) {
  const W = k.width(), H = k.height();
  const narrow = W < 560;
  const PW = narrow ? W - 16 : Math.min(920, W - 40);
  const PH = Math.min(narrow ? H - 24 : 612, H - 32);
  return { px: Math.round((W - PW) / 2), py: Math.round((H - PH) / 2), PW, PH, narrow, pad: narrow ? PAD_N : PAD_W, headH: narrow ? HEAD_N : HEAD_W };
}

export function stationContentRect(k) {
  const { px, py, PW, PH, pad, headH } = stationPopupRect(k);
  return [px + pad, py + headH, PW - pad * 2, PH - headH - pad];
}
export function stationCloseRect(k) {
  const { px, py, PW, narrow } = stationPopupRect(k);
  const s = narrow ? 38 : 42, m = narrow ? 12 : 18;
  return [px + PW - s - m, py + m, s, s];
}
export function stationPopupInside(k, p) {
  const { px, py, PW, PH } = stationPopupRect(k);
  return p.x >= px && p.x <= px + PW && p.y >= py && p.y <= py + PH;
}

export function drawSheetMask(k, rect) {
  const [x, y, w, h] = rect;
  const { px, py, PW, PH, narrow } = stationPopupRect(k);
  k.pushClip(x, y, w, h);
  try { drawSheetBody(k, px, py, PW, PH, narrow ? 22 : 26, 1); } finally { k.popClip(); }
}
const SHEET_TINT = 0.6, SHEET_WASH = 0.03, SCRIM = 0.42;
function drawSheetBody(k, px, sy, PW, PH, R, e) {
  const col = (t) => k.rgb(...t);
  const frosted = k.frostReady && k.frostReady() && k.drawFrost({ pos: k.vec2(px, sy), width: PW, height: PH, radius: R, opacity: e });
  if (!frosted) k.drawRect({ pos: k.vec2(px, sy), width: PW, height: PH, radius: R, color: col(THEME.surface), opacity: e, fixed: true });
  k.drawRect({ pos: k.vec2(px, sy), width: PW, height: PH, radius: R, color: col(THEME.bg), opacity: SHEET_TINT * e, fixed: true });
  k.drawRect({ pos: k.vec2(px, sy), width: PW, height: PH, radius: R, color: col(WHITE), opacity: SHEET_WASH * e,
    gradient: { dir: "v", stops: [[0, WHITE, 0.06 * e], [0.35, WHITE, SHEET_WASH * e], [1, WHITE, 0.015 * e]] }, fixed: true });
  const acc = currentAccent || THEME.primary;
  k.drawRect({ pos: k.vec2(px, sy), width: PW, height: PH, radius: R, color: col(acc), opacity: e,
    gradient: { dir: "radial", cx: 0.08, cy: 0.0, r: Math.max(PW, PH) * 0.62, stops: [[0, acc, 0.2], [0.45, acc, 0.05], [1, acc, 0]] }, fixed: true });
}

export function drawStationPopup(k, { title, eyebrow = "Village", icon = "village", accent = THEME.primary, content, pointer, openedT = null, closeT = null } = {}) {
  const { px, py, PW, PH, pad, headH, narrow } = stationPopupRect(k);
  const col = (t) => k.rgb(...t);
  currentAccent = accent; currentOpenedT = closeT != null ? null : openedT;
  const age = openedT != null && typeof k.time === "function" ? Math.max(0, k.time() - openedT) : 1;
  let p = Math.min(1, age / 0.22), e = 1 - (1 - p) * (1 - p) * (1 - p), dy = (1 - e) * 16;
  if (closeT != null && typeof k.time === "function") {
    const cp = Math.min(1, Math.max(0, (k.time() - closeT) / 0.16));
    e = (1 - cp) * (1 - cp); dy = cp * 12; p = cp < 0.35 ? 1 : 0;
  }
  const W = k.width(), H = k.height();
  k.drawRect({ pos: k.vec2(0, 0), width: W, height: H, color: col([0, 0, 0]), opacity: SCRIM * e, fixed: true });
  const R = narrow ? 22 : 26, sy = py + dy;
  k.drawRect({ pos: k.vec2(px - 10, sy + 4), width: PW + 20, height: PH + 14, radius: R + 10, color: col(THEME.bgAlt), opacity: 0.16 * e, fixed: true });
  k.drawRect({ pos: k.vec2(px - 4, sy + 5), width: PW + 8, height: PH + 7, radius: R + 4, color: col(THEME.bgAlt), opacity: 0.22 * e, fixed: true });
  k.drawRect({ pos: k.vec2(px + 2, sy + 6), width: PW - 4, height: PH + 2, radius: R, color: col(THEME.bgAlt), opacity: 0.3 * e, fixed: true });
  drawSheetBody(k, px, sy, PW, PH, R, e);
  k.drawRect({ pos: k.vec2(px + 0.5, sy + 0.5), width: PW - 1, height: PH - 1, radius: R - 0.5, color: col(WHITE), opacity: 0.12 * e, fill: false, outline: { width: 1, color: col(WHITE) }, fixed: true });
  k.drawRect({ pos: k.vec2(px + R, sy + 1), width: PW - R * 2, height: 1, color: col(WHITE), opacity: 0.22 * e, fixed: true });
  if (e > 0.5) drawMotes(k, { rect: [px + 8, sy + headH, PW - 16, PH - headH - 8], color: accent, count: narrow ? 8 : 12, opacity: 0.16 * e, fixed: true });
  drawSweep(k, { rect: [px + 1, sy + 1, PW - 2, headH - 12], opacity: 0.06 * e, fixed: true });
  drawCornerTicks(k, { rect: [px, sy, PW, PH], color: accent, opacity: 0.55 * e, inset: 12, len: 12, which: ["tr", "bl", "br"], fixed: true });
  const tabS = narrow ? 44 : 56;
  const tab = drawIconTab(k, { x: px + pad, y: sy - (narrow ? 10 : 14), size: tabS, icon, accent, opacity: e, fixed: true });
  const hx = tab[0] + tab[2] + (narrow ? 12 : 18);
  drawEyebrow(k, { x: hx, y: sy + (narrow ? 14 : 20), text: eyebrow, size: TYPE.eyebrow - (narrow ? 1 : 0), color: accent, spacing: 2.4, opacity: e, fixed: true });
  k.drawText({ text: title || "", pos: k.vec2(hx - 1, sy + (narrow ? 28 : 36)), size: narrow ? 27 : TYPE.display, font: FONT_BOLD, color: col(THEME.text), opacity: e, fixed: true });
  drawHairline(k, { x: px + pad, y: sy + headH - 10, w: PW - pad * 2, opacity: 0.1 * e, fixed: true });
  const cr = stationCloseRect(k);
  drawCloseX(k, { rect: [cr[0], cr[1] + dy, cr[2], cr[3]], hover: pointer ? inRect(pointer, cr) : false, fixed: true });
  if (p < 0.45) return;
  const rect = stationContentRect(k);
  k.pushClip(rect[0], rect[1] - 2, rect[2], rect[3] + 2);
  try { if (content) content(k, rect); } finally { k.popClip(); }
}

export { GLASS, drawGlass };
