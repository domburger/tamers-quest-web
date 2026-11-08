// TQ-118 (epic TQ-99 / decision TQ-126 "true overlay"): a reusable IN-LOBBY STATION POPUP shell.
// A station (Bestiary, shop, cosmetics, settings…) opens as a SHEET over the still-drawn village + HUD,
// instead of switching scenes — so the lobby never blanks. The HOST scene (hub.js) owns the open/close
// state and supplies a station's content via a render(k, rect)+onTap contract; this module draws the chrome
// and CLIPS the content to the sheet body with k.pushClip/k.popClip (TQ-164), exposing geometry + hit-tests
// so the host can route taps / scroll / Esc.
//
// UI v3 (2026-11, "Glass & Ember"): the sheet is FROSTED GLASS — the host calls k.requestFrost() on open and
// the shell paints the blurred village snapshot under a dark tint (k.drawFrost), so the lobby glows through.
// A big bold title with a letter-spaced eyebrow, a hairline (not a band) under the header, a glass close
// circle with a drawn cross, and a 0.22s rise-in. Content modules that pin a band (tabs / wallet) over
// scrolling rows mask it with drawSheetMask() so the band matches the sheet instead of painting a grey slab.
import { THEME, FONT_BOLD, GLASS, WHITE, drawEyebrow, drawHairline, drawGlass, drawCloseX, inRect } from "./theme.js";

// Frosted MODAL sheet (monster detail, confirmations…): the same glass as the station sheet, any rect.
export function drawGlassSheet(k, { rect, radius = 22, opacity = 1, accent = null } = {}) {
  const [x, y, w, h] = rect;
  const col = (t) => k.rgb(...t);
  k.drawRect({ pos: k.vec2(x - 6, y + 4), width: w + 12, height: h + 10, radius: radius + 6, color: col(THEME.bgAlt), opacity: 0.2 * opacity, fixed: true });
  k.drawRect({ pos: k.vec2(x + 2, y + 6), width: w - 4, height: h + 2, radius, color: col(THEME.bgAlt), opacity: 0.3 * opacity, fixed: true });
  drawSheetBody(k, x, y, w, h, radius, opacity);
  if (accent) k.drawRect({ pos: k.vec2(x + 1, y + 1), width: w - 2, height: h - 2, radius: radius - 1, color: col(accent), opacity,
    gradient: { dir: "radial", cx: 0.2, cy: 0.1, r: Math.max(w, h) * 0.6, stops: [[0, accent, 0.18], [0.5, accent, 0.04], [1, accent, 0]] }, fixed: true });
  k.drawRect({ pos: k.vec2(x + 0.5, y + 0.5), width: w - 1, height: h - 1, radius: radius - 0.5, color: col(WHITE), opacity: 0.12 * opacity, fill: false, outline: { width: 1, color: col(WHITE) }, fixed: true });
  k.drawRect({ pos: k.vec2(x + radius, y + 1), width: w - radius * 2, height: 1, color: col(WHITE), opacity: 0.22 * opacity, fixed: true });
}

const PAD_W = 22, PAD_N = 12;
const HEAD_W = 86, HEAD_N = 70;

// Sheet rect for the current viewport (responsive: near-full on narrow/portrait).
export function stationPopupRect(k) {
  const W = k.width(), H = k.height();
  const narrow = W < 560;
  const PW = narrow ? W - 16 : Math.min(920, W - 40);
  const PH = Math.min(narrow ? H - 24 : 612, H - 32);
  return { px: Math.round((W - PW) / 2), py: Math.round((H - PH) / 2), PW, PH, narrow, pad: narrow ? PAD_N : PAD_W, headH: narrow ? HEAD_N : HEAD_W };
}

// The content area (below the header, inside padding) — where the station draws + scrolls.
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

// The sheet's own backdrop for a sub-rect (frost + tint): content modules call this to re-cover a pinned
// band (tabs / wallet / loadout) so rows scroll UNDER it and the band reads as the same glass as the sheet.
export function drawSheetMask(k, rect) {
  const [x, y, w, h] = rect;
  const { px, py, PW, PH, narrow } = stationPopupRect(k);
  // Clip to the band and repaint the WHOLE sheet backdrop (frost + tint + the same vertical wash gradient),
  // so the band is pixel-identical to the sheet around it (no seam, no lighter strip).
  k.pushClip(x, y, w, h);
  try { drawSheetBody(k, px, py, PW, PH, narrow ? 22 : 26, 1); } finally { k.popClip(); }
}
const SHEET_TINT = 0.62, SHEET_WASH = 0.03, SCRIM = 0.42;
// The sheet's backdrop layers: frosted village (or a flat surface before the first capture), a dark tint and
// a faint top-lit white wash. Shared by the shell and the band masks.
function drawSheetBody(k, px, sy, PW, PH, R, e) {
  const col = (t) => k.rgb(...t);
  const frosted = k.frostReady && k.frostReady() && k.drawFrost({ pos: k.vec2(px, sy), width: PW, height: PH, radius: R, opacity: e });
  if (!frosted) k.drawRect({ pos: k.vec2(px, sy), width: PW, height: PH, radius: R, color: col(THEME.surface), opacity: e, fixed: true });
  k.drawRect({ pos: k.vec2(px, sy), width: PW, height: PH, radius: R, color: col(THEME.bg), opacity: SHEET_TINT * e, fixed: true });
  k.drawRect({ pos: k.vec2(px, sy), width: PW, height: PH, radius: R, color: col(WHITE), opacity: SHEET_WASH * e,
    gradient: { dir: "v", stops: [[0, WHITE, 0.06 * e], [0.35, WHITE, SHEET_WASH * e], [1, WHITE, 0.015 * e]] }, fixed: true });
}

/**
 * Draw the sheet chrome + the station's content (clipped to the body).
 * @param k           compat ctx (fixed/screen-space draws)
 * @param {string}    title    station title
 * @param {string}    eyebrow  small-caps label above the title (default "Village")
 * @param {Function}  content  (k, contentRect) → draws the station body inside the clip
 * @param {{x,y}}     pointer  current pointer (design coords) for hover states; optional
 */
export function drawStationPopup(k, { title, eyebrow = "Village", content, pointer, openedT = null, closeT = null } = {}) {
  const { px, py, PW, PH, pad, headH, narrow } = stationPopupRect(k);
  const col = (t) => k.rgb(...t);
  // TQ-555: rise-in. For the first ~0.22s after `openedT` (scene time) the sheet fades in and rises; the
  // clipped content lands once the sheet is mostly in so nothing draws outside the rising frame.
  const age = openedT != null && typeof k.time === "function" ? Math.max(0, k.time() - openedT) : 1;
  let p = Math.min(1, age / 0.22), e = 1 - (1 - p) * (1 - p) * (1 - p), dy = (1 - e) * 16;
  // Close-out (closeT = scene time the close began): the sheet sinks + fades over 0.16s; content drops first.
  if (closeT != null && typeof k.time === "function") {
    const cp = Math.min(1, Math.max(0, (k.time() - closeT) / 0.16));
    e = (1 - cp) * (1 - cp); dy = cp * 12; p = cp < 0.35 ? 1 : 0; // p<0.45 below skips the content
  }
  const W = k.width(), H = k.height();
  // Scrim: the village stays visible (dimmed) around the sheet — the lobby never blanks.
  k.drawRect({ pos: k.vec2(0, 0), width: W, height: H, color: col([0, 0, 0]), opacity: SCRIM * e, fixed: true });
  const R = narrow ? 22 : 26, sy = py + dy;
  // Shadow under the sheet: three flat widening layers (no per-frame ctx blur), kept close so it reads as
  // ambient depth rather than a lip under the sheet.
  k.drawRect({ pos: k.vec2(px - 10, sy + 4), width: PW + 20, height: PH + 14, radius: R + 10, color: col(THEME.bgAlt), opacity: 0.16 * e, fixed: true });
  k.drawRect({ pos: k.vec2(px - 4, sy + 5), width: PW + 8, height: PH + 7, radius: R + 4, color: col(THEME.bgAlt), opacity: 0.22 * e, fixed: true });
  k.drawRect({ pos: k.vec2(px + 2, sy + 6), width: PW - 4, height: PH + 2, radius: R, color: col(THEME.bgAlt), opacity: 0.3 * e, fixed: true });
  drawSheetBody(k, px, sy, PW, PH, R, e);
  // Edge: a 1px white hairline + a brighter catch-light along the top edge.
  k.drawRect({ pos: k.vec2(px + 0.5, sy + 0.5), width: PW - 1, height: PH - 1, radius: R - 0.5, color: col(WHITE), opacity: 0.12 * e, fill: false, outline: { width: 1, color: col(WHITE) }, fixed: true });
  k.drawRect({ pos: k.vec2(px + R, sy + 1), width: PW - R * 2, height: 1, color: col(WHITE), opacity: 0.22 * e, fixed: true });
  // Header: eyebrow + big title, then a hairline. The ember is reserved for the title's short accent bar.
  const hx = px + pad + 2;
  drawEyebrow(k, { x: hx, y: sy + (narrow ? 16 : 22), text: eyebrow, size: narrow ? 10 : 11, color: THEME.primary, spacing: 2.4, opacity: e, fixed: true });
  k.drawText({ text: title || "", pos: k.vec2(hx - 1, sy + (narrow ? 30 : 38)), size: narrow ? 26 : 32, font: FONT_BOLD, color: col(THEME.text), opacity: e, fixed: true });
  drawHairline(k, { x: px + pad, y: sy + headH - 10, w: PW - pad * 2, opacity: 0.1 * e, fixed: true });
  // Close — a glass circle with a drawn cross.
  const cr = stationCloseRect(k);
  drawCloseX(k, { rect: [cr[0], cr[1] + dy, cr[2], cr[3]], hover: pointer ? inRect(pointer, cr) : false, fixed: true });
  // Content — clipped to the body so a scrolling grid can't spill past the sheet (TQ-164).
  if (p < 0.45) return; // still rising — content lands on the next frames
  const rect = stationContentRect(k);
  k.pushClip(rect[0], rect[1] - 2, rect[2], rect[3] + 2);
  try { if (content) content(k, rect); } finally { k.popClip(); }
}

// Re-exported for content modules that want the exact sheet glass tokens (e.g. a pinned band's wash).
export { GLASS, drawGlass };
