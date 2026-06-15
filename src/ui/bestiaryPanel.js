// TQ-118: compact Bestiary CONTENT for the in-lobby station popup (the pilot station). A scrollable
// grid of monster-type cards drawn INTO a given rect (the shell clips it), tapping one opens the
// SHARED monster-detail popup (ui/monsterDetail.js). Reuses the gamedata + theme helpers; the full
// bestiary scene (filters / NEW badges) stays the out-of-lobby fallback route. All draws are fixed
// (screen-space) so the shell's k.pushClip masks them.
import { getMonsterTypes } from "../engine/gamedata.js";
import { THEME, elementColor, drawPanel } from "./theme.js";
import { drawMonsterIcon } from "../render/monster.js"; // TQ-351: shrink tall sprites so they don't bleed above the bestiary card

const CW = 150, CH = 124, G = 14;
const slug = (n) => String(n || "").toLowerCase().replace(/\s+/g, "_");
function ink(c) { // brighten a dark element colour for legible label text
  const lum = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  if (lum >= 0.5) return c;
  const f = 0.5 / Math.max(0.12, lum);
  return [Math.min(255, Math.round(c[0] * f)), Math.min(255, Math.round(c[1] * f)), Math.min(255, Math.round(c[2] * f))];
}

// `caught` (optional) = a Set of lowercased typeNames the player owns → uncaught cards dim.
export function bestiaryPanelState(caught = null) {
  return { scrollY: 0, selected: null, caught, _cols: 1, _maxScroll: 0 };
}

function layout(k, rect, state) {
  const [rx, , rw] = rect;
  const cols = Math.max(1, Math.floor((rw + G) / (CW + G)));
  const gridW = cols * CW + (cols - 1) * G;
  const x0 = rx + (rw - gridW) / 2;
  state._cols = cols;
  return { cols, x0, top: rect[1] + 8 - state.scrollY };
}

export function drawBestiaryPanel(k, rect, state) {
  const [rx, ry, rw, rh] = rect;
  const T = (n) => { const c = THEME[n] || [255, 255, 255]; return k.rgb(c[0], c[1], c[2]); };
  const types = getMonsterTypes();
  const { cols, x0, top } = layout(k, rect, state);
  for (let i = 0; i < types.length; i++) {
    const cx = x0 + (i % cols) * (CW + G), cy = top + Math.floor(i / cols) * (CH + G);
    if (cy + CH < ry || cy > ry + rh) continue; // cull off-rect rows
    const mt = types[i];
    const col = elementColor(mt.element);
    drawPanel(k, { rect: [cx, cy, CW, CH], radius: 12, fill: THEME.surface, border: col, borderW: 2, fixed: true });
    drawMonsterIcon(k, { sprite: slug(mt.typeName), cx: cx + CW / 2, cy: cy + 46, scale: 0.62, topY: cy + 2, fixed: true }); // TQ-351: shrink tall sprites to fit the card
    k.drawText({ text: mt.typeName, pos: k.vec2(cx + CW / 2, cy + CH - 38), size: 13, font: "gameFont", anchor: "center", width: CW - 12, color: T("text"), fixed: true });
    const lab = ink(col);
    k.drawText({ text: mt.element || "Neutral", pos: k.vec2(cx + CW / 2, cy + CH - 18), size: 11, font: "gameFont", anchor: "center", color: k.rgb(lab[0], lab[1], lab[2]), fixed: true });
    if (state.caught && !state.caught.has(String(mt.typeName).toLowerCase())) {
      k.drawRect({ pos: k.vec2(cx, cy), width: CW, height: CH, radius: 12, color: T("bg"), opacity: 0.5, fixed: true }); // uncaught → dim
    }
  }
  const rows = Math.ceil(types.length / cols);
  state._maxScroll = Math.max(0, rows * (CH + G) + 16 - rh);
  // NOTE: the selected monster's detail is drawn by the HOST after the popup (OUTSIDE the clip), so the
  // shared full-screen monster-detail modal isn't masked to the content rect.
}

// Tap handling inside the content rect. Returns true if consumed. Closes an open detail first.
export function bestiaryPanelTap(k, rect, state, p) {
  if (state.selected) { state.selected = null; return true; }
  const [rx, ry, rw, rh] = rect;
  if (p.x < rx || p.x > rx + rw || p.y < ry || p.y > ry + rh) return false;
  const types = getMonsterTypes();
  const { cols, x0, top } = layout(k, rect, state);
  for (let i = 0; i < types.length; i++) {
    const cx = x0 + (i % cols) * (CW + G), cy = top + Math.floor(i / cols) * (CH + G);
    if (p.x >= cx && p.x <= cx + CW && p.y >= cy && p.y <= cy + CH) { state.selected = types[i]; return true; }
  }
  return false;
}

export function bestiaryPanelScroll(state, dy) {
  state.scrollY = Math.max(0, Math.min(state._maxScroll, state.scrollY + dy));
}
