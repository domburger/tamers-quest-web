// ─────────────────────────────────────────────────────────────────────────────
// Design system — "Crisp daylight flat"
// One source of truth for every color, font and UI primitive in the game.
// Scenes should pull from THEME / addButton / addPanel instead of hardcoding
// RGB triples. Colors are stored as [r,g,b] arrays (what Kaboom's k.color wants)
// with hex mirrors for canvas (spritegen) and HTML use.
// ─────────────────────────────────────────────────────────────────────────────

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// Raw palette ----------------------------------------------------------------
export const PAL = {
  // Neutral surfaces (light, flat)
  bg:        "#EEF0F4", // app background
  surface:   "#FFFFFF", // cards / panels
  surfaceAlt:"#E3E7EE", // recessed / secondary fill
  line:      "#CDD3DD", // hairline borders
  // Ink
  text:      "#161A22", // primary text on light
  textMut:   "#5C6675", // secondary text
  textInv:   "#F7F9FC", // text on colored / dark fills
  // Brand + actions (strong, saturated)
  primary:   "#2B7FE0", // primary action (water blue)
  primaryDk: "#1C5FB0",
  // Semantic
  success:   "#2BA84A",
  successDk: "#1E8138",
  danger:    "#E23B2E",
  dangerDk:  "#B22A20",
  warn:      "#F5A623",
  // Element identity (saturated, flat)
  fire:      "#F0452D",
  water:     "#2B7FE0",
  nature:    "#34A853",
  earth:     "#C68A3E",
  air:       "#5EC8E0",
  ice:       "#7FD4F0",
  dark:      "#7A4FD0",
  light:     "#F5C53B",
  poison:    "#B14FD0",
  metal:     "#9AA4B2",
  psychic:   "#E24FB0",
  neutral:   "#8A93A3",
  // Dark backdrop used only for the in-game cave world (kept readable, flattened)
  cave:      "#1B1F2A",
  caveDeep:  "#12151D",
};

// Semantic, kaboom-ready RGB tokens ------------------------------------------
export const THEME = Object.fromEntries(
  Object.entries(PAL).map(([k, v]) => [k, hex(v)])
);

export const FONT = "gameFont";

// Element name -> hex, with sensible fallbacks for AI-generated element names.
const ELEMENT_HEX = {
  fire: PAL.fire, water: PAL.water, nature: PAL.nature, grass: PAL.nature,
  earth: PAL.earth, sand: PAL.earth, rock: PAL.earth, air: PAL.air, wind: PAL.air,
  ice: PAL.ice, dark: PAL.dark, darkness: PAL.dark, shadow: PAL.dark,
  light: PAL.light, holy: PAL.light, electric: PAL.light, lightning: PAL.light,
  poison: PAL.poison, acid: PAL.nature, metal: PAL.metal, steel: PAL.metal,
  psychic: PAL.psychic, ghost: PAL.dark, normal: PAL.neutral, physical: PAL.neutral,
};
export function elementColor(name) {
  return hex(ELEMENT_HEX[String(name || "").toLowerCase()] || PAL.neutral);
}

// ─── Kaboom UI primitives ────────────────────────────────────────────────────
// Helpers that stamp consistent, flat components onto the current scene.

const toCol = (k, c) => (Array.isArray(c) ? k.rgb(...c) : k.Color.fromHex(c));

// A flat card/panel: solid fill + hairline border, square-ish soft corners.
export function addPanel(k, { x, y, w, h, anchor = "center", fill = THEME.surface,
  border = THEME.line, radius = 14, opacity = 1, fixed = false } = {}) {
  const comps = [
    k.rect(w, h, { radius }),
    k.pos(x, y),
    k.anchor(anchor),
    k.color(...fill),
    k.outline(2, toCol(k, border)),
    k.opacity(opacity),
  ];
  if (fixed) comps.push(k.fixed());
  return k.add(comps);
}

// A flat button with hover/press feedback and a centered label. Returns the
// background game-obj (with .label) so callers can attach onClick.
export function addButton(k, { x, y, w = 220, h = 52, text = "", anchor = "center",
  fill = THEME.primary, textColor = THEME.textInv, size = 22, radius = 12,
  onClick, fixed = false } = {}) {
  const base = k.rgb(...fill);
  const hover = base.lighten(18);
  const comps = [
    k.rect(w, h, { radius }),
    k.pos(x, y),
    k.anchor(anchor),
    k.color(base),
    k.area(),
    "tq-button",
  ];
  if (fixed) comps.push(k.fixed());
  const btn = k.add(comps);

  const labelComps = [
    k.text(text, { size, font: FONT }),
    k.pos(x, y + 1),
    k.anchor(anchor),
    k.color(...textColor),
  ];
  if (fixed) labelComps.push(k.fixed());
  btn.label = k.add(labelComps);

  btn.onHover(() => { k.setCursor("pointer"); });
  btn.onHoverUpdate(() => { btn.color = hover; });
  btn.onHoverEnd(() => { btn.color = base; k.setCursor("default"); });
  if (onClick) btn.onClick(onClick);
  return btn;
}

// Plain themed text label.
export function addLabel(k, { x, y, text, size = 22, anchor = "center",
  color = THEME.text, width, fixed = false, opacity = 1 } = {}) {
  const comps = [
    k.text(text, { size, font: FONT, ...(width ? { width } : {}) }),
    k.pos(x, y),
    k.anchor(anchor),
    k.color(...color),
    k.opacity(opacity),
  ];
  if (fixed) comps.push(k.fixed());
  return k.add(comps);
}
