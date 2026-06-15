// TQ-118: compact Bestiary CONTENT for the in-lobby station popup (the pilot station). A scrollable
// grid of monster-type cards drawn INTO a given rect (the shell clips it), tapping one opens the
// SHARED monster-detail popup (ui/monsterDetail.js). Reuses the gamedata + theme helpers; the full
// bestiary scene (filters / NEW badges) stays the out-of-lobby fallback route. All draws are fixed
// (screen-space) so the shell's k.pushClip masks them.
import { getMonsterTypes } from "../engine/gamedata.js";
import { THEME, accentColor, drawPanel } from "./theme.js";
import { drawMonsterIcon } from "../render/monster.js"; // TQ-351: shrink tall sprites so they don't bleed above the bestiary card

const CW = 150, CH = 124, G = 14;
const slug = (n) => String(n || "").toLowerCase().replace(/\s+/g, "_");

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
    const col = accentColor();
    drawPanel(k, { rect: [cx, cy, CW, CH], radius: 12, fill: THEME.surface, border: col, borderW: 2, fixed: true });
    drawMonsterIcon(k, { sprite: slug(mt.typeName), cx: cx + CW / 2, cy: cy + 46, scale: 0.62, topY: cy + 2, fixed: true }); // TQ-351: shrink tall sprites to fit the card
    // TQ-352: legibility plate behind the name — it sits over the monster's lower body, so a
    // same-hued monster (e.g. green name over a green golem) washed out. Mirrors the roster card plate.
    k.drawRect({ pos: k.vec2(cx + 6, cy + CH - 36), width: CW - 12, height: 30, radius: 8, color: T("bg"), opacity: 0.55, fixed: true });
    k.drawText({ text: mt.typeName, pos: k.vec2(cx + CW / 2, cy + CH - 22), size: 13, font: "gameFont", anchor: "center", width: CW - 12, color: T("text"), fixed: true });
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
