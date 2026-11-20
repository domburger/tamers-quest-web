import { sfx, haptic } from "../systems/audio.js";
import { prefersReducedMotion } from "../systems/a11y.js";
import { drawCurrencyIcon } from "../render/currencyIcon.js";
import { drawIcon, iconSpriteKey } from "./icons.js";

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const PAL = {
  bg:        "#15110F",
  bgAlt:     "#0B0908",
  surface:   "#231C18",
  surface2:  "#302722",
  surfaceAlt:"#302722",
  surfaceHi: "#3C322C",
  line:      "#483C35",
  lineSoft:  "#2A2320",
  lineHi:    "#5F5047",
  text:      "#F5EFE9",
  textBody:  "#CDC1B7",
  textMut:   "#A3968C",
  textInv:   "#2A0B05",
  primary:   "#F0533D",
  primaryDk: "#B23625",
  teal:      "#FF7A52",
  violet:    "#B58BE6",
  amber:     "#E8B25E",
  success:   "#5BD18C",
  danger:    "#E63B46",
  warn:      "#E8B25E",
  fire:      "#FF6A4D",
  water:     "#46A6FF",
  nature:    "#5BD17E",
  earth:     "#D6A05A",
  air:       "#6FD8E8",
  ice:       "#C8F0FF",
  dark:      "#A67FE6",
  light:     "#FFDC6A",
  poison:    "#C46FD6",
  metal:     "#7E8AA0",
  psychic:   "#FF6FC2",
  neutral:   "#93A0A6",
  cave:      "#0C0C0D",
  caveDeep:  "#060607",
  portal:    "#5ADCFF",
  storm:     "#6EA0FF",
  stormLite: "#B4DCFF",
};

export const THEME = Object.fromEntries(Object.entries(PAL).map(([k, v]) => [k, hex(v)]));

export const FONT = "gameFont";
export const FONT_BOLD = "gameFontBold";
export const FONT_BODY = "gameFontBody";

const NEUTRAL_ACCENT = Object.freeze(hex(PAL.neutral));
export function accentColor() {
  return NEUTRAL_ACCENT;
}

export function hpColor(frac) {
  return frac > 0.5 ? THEME.success : frac > 0.25 ? THEME.warn : THEME.danger;
}

export function addPanel(k, { x, y, w, h, anchor = "center", fill = THEME.surface,
  border = THEME.line, radius = 16, opacity = 1, fixed = false, shadow = true, area = false, z, tag } = {}) {
  const F = (comps) => {
    let c = fixed ? [...comps, k.fixed()] : [...comps];
    if (z != null) c.push(k.z(z));
    return tag ? [...c, tag] : c;
  };
  const [ox, oy] = anchorOffset(anchor, w, h);
  const left = x - ox, top = y - oy;
  if (shadow) {
    k.add(F([k.rect(w + 12, h + 10, { radius: radius + 6 }), k.pos(left - 6, top + 4), k.anchor("topleft"), k.color(...THEME.bgAlt), k.opacity(0.22 * opacity)]));
    k.add(F([k.rect(w - 4, h + 2, { radius }), k.pos(left + 2, top + 6), k.anchor("topleft"), k.color(...THEME.bgAlt), k.opacity(0.32 * opacity)]));
  }
  k.add(F([k.rect(w, h, { radius }), k.pos(x, y), k.anchor(anchor), k.color(...THEME.bg), k.opacity(0.8 * opacity)]));
  const raised = _eqCol(fill, THEME.surface2) || _eqCol(fill, THEME.surfaceAlt);
  const bodyComps = [k.rect(w, h, { radius }), k.pos(x, y), k.anchor(anchor), k.color(...WHITE), k.opacity((raised ? 0.08 : 0.05) * opacity)];
  if (area) bodyComps.push(k.area());
  const panel = k.add(F(bodyComps));
  const accentBorder = !_eqCol(border, THEME.line);
  k.add(F([k.rect(w - 1, h - 1, { radius: Math.max(0, radius - 0.5), fill: false }), k.pos(left + 0.5, top + 0.5), k.anchor("topleft"),
    k.color(...(accentBorder ? border : WHITE)), k.opacity((accentBorder ? 1 : 0.12) * opacity), k.outline(accentBorder ? 1.5 : 1, k.rgb(...(accentBorder ? border : WHITE)))]));
  k.add(F([k.rect(Math.max(4, w - radius * 2), 1, { radius: 0.5 }), k.pos(left + radius, top + 1), k.anchor("topleft"), k.color(...WHITE), k.opacity(0.2 * opacity)]));
  return panel;
}

function anchorOffset(anchor, w, h) {
  const a = String(anchor || "center");
  const ox = /left/.test(a) ? 0 : /right/.test(a) ? w : w / 2;
  const oy = /top/.test(a) ? 0 : /bot/.test(a) ? h : h / 2;
  return [ox, oy];
}

export function buttonGradient(fill) {
  return { dir: "v", stops: [[0, lighten(fill, 26)], [0.5, fill], [1, darken(fill, 22)]] };
}

const _eqCol = (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
export const isSurfaceFill = (c) => _eqCol(c, THEME.surface) || _eqCol(c, THEME.surfaceAlt) || _eqCol(c, THEME.surface2);

export function addButton(k, { x, y, w = 240, h = 54, text = "", anchor = "center",
  fill = THEME.primary, textColor = THEME.textInv, size = 20, radius = 14,
  onClick, fixed = false, glow = THEME.teal, glowOn = false, disabled = false, z, tag, icon = null } = {}) {
  const extra = tag ? [tag] : [];
  const F = (comps) => {
    const c = [...comps, ...extra];
    if (z != null) c.push(k.z(z));
    return fixed ? [...c, k.fixed()] : c;
  };
  const ghost = isSurfaceFill(fill);
  const base = disabled ? THEME.surfaceAlt : fill;
  const ink = disabled ? THEME.textMut : textColor;
  const restGlow = (glowOn && !ghost && !disabled) ? 0.2 : 0;
  const baseC = k.rgb(...base), hoverC = k.rgb(...lighten(base, ghost ? 18 : 12)), pressC = k.rgb(...lighten(base, 26));

  const lift = [];
  const haloOut = k.add(F([k.rect(w + 14, h + 14, { radius: Math.min(w + 14, h + 14) / 2 }), k.pos(x, y + 4),
    k.anchor(anchor), k.color(...glow), k.opacity(restGlow * 0.45)]));
  const haloIn = k.add(F([k.rect(w + 6, h + 6, { radius: Math.min(w + 6, h + 6) / 2 }), k.pos(x, y + 4),
    k.anchor(anchor), k.color(...glow), k.opacity(restGlow)]));
  lift.push({ o: haloOut, y0: y + 4 }, { o: haloIn, y0: y + 4 });
  const setGlow = (lv) => { try { haloIn.opacity = lv; haloOut.opacity = lv * 0.45; } catch {} };
  let btn;
  const glassy = ghost || disabled;
  if (glassy) {
    const wash = disabled ? 0.04 : 0.07;
    const bodyComps = [k.rect(w, h, { radius }), k.pos(x, y), k.anchor(anchor), k.color(...WHITE), k.opacity(wash), k.area(), "tq-button"];
    btn = k.add(F(bodyComps));
    lift.push({ o: btn, y0: y });
    btn._wash = wash;
    lift.push({ o: k.add(F([k.rect(w, h, { radius, fill: false }), k.pos(x, y), k.anchor(anchor), k.color(...WHITE), k.opacity(disabled ? 0.08 : 0.16), k.outline(1, k.rgb(...WHITE))])), y0: y });
  } else {
    k.add(F([k.rect(w, h, { radius: Math.min(w, h) / 2 }), k.pos(x, y + 3), k.anchor(anchor), k.color(...THEME.bgAlt), k.opacity(0.45)]));
    const bodyComps = [k.rect(w, h, { radius, gradient: buttonGradient(base) }), k.pos(x, y), k.anchor(anchor), k.color(baseC),
      k.outline(1, k.rgb(...darken(base, 40))), k.area(), "tq-button"];
    btn = k.add(F(bodyComps));
    lift.push({ o: btn, y0: y });
    const [ox, oy] = anchorOffset(anchor, w, h);
    const hy = y - oy + 1.5;
    lift.push({ o: k.add(F([k.rect(Math.max(4, w - radius * 2), 1.2, { radius: 0.6 }), k.pos(x - ox + radius, hy), k.anchor("topleft"),
      k.color(...lighten(base, 90)), k.opacity(0.5)])), y0: hy, x0: x - ox + radius });
  }
  let labelX = x;
  const iconKey = icon && anchor === "center" ? iconSpriteKey(k, icon, { size: Math.round(size * 1.05), color: ink }) : null;
  if (iconKey) {
    const isz = Math.round(size * 1.05), gap = Math.round(size * 0.45);
    const tw = typeof k.measureText === "function" ? k.measureText(text, size, FONT_BOLD) : String(text).length * size * 0.55;
    const left = x - (isz + gap + tw) / 2;
    const ix = left + isz / 2;
    labelX = left + isz + gap + tw / 2;
    lift.push({ o: k.add(F([k.sprite(iconKey), k.pos(ix, y), k.anchor("center"), k.scale(0.5)])), y0: y, x0: ix });
  }
  btn.label = k.add(F([k.text(text, { size, font: FONT_BOLD }), k.pos(labelX, y + 1),
    k.anchor(anchor), k.color(...ink)]));
  lift.push({ o: btn.label, y0: y + 1, x0: labelX });
  const setLift = (dy) => { for (const { o, y0, x0 } of lift) { try { o.pos = k.vec2(x0 != null ? x0 : x, y0 + dy); } catch {} } };
  const setHot = (lv) => { try { if (glassy) btn.opacity = lv === 2 ? GLASS.fillPress : lv === 1 ? GLASS.fillHover : btn._wash; else btn.color = lv === 2 ? pressC : lv === 1 ? hoverC : baseC; } catch {} };

  if (!disabled) {
    btn.onHover(() => { k.setCursor("pointer"); sfx("hover"); });
    btn.onHoverUpdate(() => { setHot(1); setGlow(glowOn ? (ghost ? 0.22 : 0.36) : 0); setLift(-2); });
    btn.onHoverEnd(() => { setHot(0); setGlow(restGlow); setLift(0); k.setCursor("default"); });
    if (onClick) btn.onClick(() => {
      sfx("click"); haptic(8);
      try { setHot(2); setGlow(glowOn ? (ghost ? 0.4 : 0.52) : 0); setLift(0); } catch {}
      k.wait(0.09, () => { try { setHot(0); setGlow(restGlow); } catch {} });
      onClick();
    });
  }
  return btn;
}

export function lighten(rgb, amt) {
  return [Math.min(255, rgb[0] + amt), Math.min(255, rgb[1] + amt), Math.min(255, rgb[2] + amt)];
}

export function darken(rgb, amt) {
  return [Math.max(0, rgb[0] - amt), Math.max(0, rgb[1] - amt), Math.max(0, rgb[2] - amt)];
}

export function inRect(p, [x, y, w, h]) {
  return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
}


export function drawButton(k, { rect, text = "", fill = THEME.primary, textColor = THEME.textInv,
  size = 16, radius = 14, hover = false, pressed = false, disabled = false, opacity = 1,
  font = FONT_BOLD, glow = THEME.teal, glowOn = false, outline = THEME.line, outlineW = 2, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  const col = (t) => k.rgb(...t);
  const live = !disabled;
  const base = disabled ? THEME.surfaceAlt : fill;
  const fillCol = pressed && live ? lighten(base, 30) : hover && live ? lighten(base, 16) : base;
  const op = disabled ? 0.55 : opacity;
  const ghost = isSurfaceFill(fill);
  const glowOp = (!live || !glowOn) ? 0 : pressed ? (ghost ? 0.4 : 0.52) : hover ? (ghost ? 0.22 : 0.36) : (ghost ? 0 : 0.18);
  if (glowOp > 0) {
    k.drawRect({ pos: k.vec2(x - 7, y - 7), width: w + 14, height: h + 14, radius: Math.min(w + 14, h + 14) / 2, color: col(glow), opacity: glowOp * 0.45 * op, fixed });
    k.drawRect({ pos: k.vec2(x - 3, y - 3), width: w + 6,  height: h + 6,  radius: Math.min(w + 6, h + 6) / 2, color: col(glow), opacity: glowOp * op, fixed });
  }
  const press = pressed && live ? 1 : 0;
  const custom = outline !== THEME.line ? outline : null;
  if (ghost || !live) {
    const wash = !live ? 0.04 : pressed ? GLASS.fillPress : hover ? GLASS.fillHover : 0.07;
    k.drawRect({ pos: k.vec2(x, y + press), width: w, height: h, radius, color: col(WHITE), opacity: wash * op, fixed });
    k.drawRect({ pos: k.vec2(x + 0.5, y + press + 0.5), width: w - 1, height: h - 1, radius: Math.max(0, radius - 0.5), color: col(custom || WHITE),
      opacity: (custom ? 1 : !live ? 0.08 : hover ? 0.3 : 0.16) * op, fill: false, outline: { width: custom ? outlineW : 1, color: col(custom || WHITE) }, fixed });
  } else {
    k.drawRect({ pos: k.vec2(x, y + 3 - press), width: w, height: h, radius: Math.min(w, h) / 2, color: col(THEME.bgAlt), opacity: 0.45 * op, fixed });
    k.drawRect({ pos: k.vec2(x, y + press), width: w, height: h, radius, color: col(fillCol), opacity: op, gradient: buttonGradient(fillCol),
      outline: { width: custom ? outlineW : 1, color: col(custom || darken(base, 40)) }, fixed });
    const inset = Math.max(2, radius * 0.9);
    k.drawRect({ pos: k.vec2(x + inset, y + press + 1.5), width: Math.max(4, w - inset * 2), height: 1.2, radius: 0.6,
      color: col(lighten(fillCol, 90)), opacity: 0.5 * op, fixed });
  }
  k.drawText({ text, pos: k.vec2(x + w / 2, y + h / 2 + press), size, font, anchor: "center",
    color: col(disabled ? THEME.textMut : textColor), fixed });
}

export function drawPanel(k, { rect, fill = THEME.surface, border = THEME.line, radius = 14,
  opacity = 1, sheen = true, shadow = true, hover = false, glow = THEME.teal, borderW = 2, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  const col = (t) => k.rgb(...t);
  const big = w * h > 90000;
  if (shadow && big) {
    k.drawRect({ pos: k.vec2(x - 10, y + 2), width: w + 20, height: h + 18, radius: radius + 10, color: col(THEME.bgAlt), opacity: 0.18 * opacity, fixed });
    k.drawRect({ pos: k.vec2(x - 5, y + 4), width: w + 10, height: h + 10, radius: radius + 5, color: col(THEME.bgAlt), opacity: 0.28 * opacity, fixed });
    k.drawRect({ pos: k.vec2(x, y + 6), width: w, height: h, radius, color: col(THEME.bgAlt), opacity: 0.5 * opacity, fixed });
  } else if (shadow) {
    k.drawRect({ pos: k.vec2(x, y + 3), width: w, height: h, radius, color: col(THEME.bgAlt), opacity: 0.45 * opacity, fixed });
  }
  void glow;
  const raised = _eqCol(fill, THEME.surface2) || _eqCol(fill, THEME.surfaceAlt);
  k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius, color: col(THEME.bg), opacity: 0.8 * opacity, fixed });
  k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius, color: col(WHITE), opacity: (hover ? 0.1 : raised ? 0.08 : 0.05) * opacity, fixed });
  const accentBorder = !_eqCol(border, THEME.line);
  k.drawRect({ pos: k.vec2(x + 0.5, y + 0.5), width: w - 1, height: h - 1, radius: Math.max(0, radius - 0.5), color: col(accentBorder ? border : WHITE),
    opacity: (accentBorder ? 1 : hover ? GLASS.lineHover : 0.12) * opacity, fill: false, outline: { width: accentBorder ? Math.max(1, borderW) : 1, color: col(accentBorder ? border : WHITE) }, fixed });
  if (sheen) k.drawRect({ pos: k.vec2(x + radius, y + 1), width: Math.max(4, w - radius * 2), height: 1, radius: 0.5, color: col(WHITE), opacity: 0.2 * opacity, fixed });
}

export const TYPE = { display: 36, title: 28, h2: 20, body: 15, small: 13, micro: 11, eyebrow: 11 };

const _count = new Map();
export function countUp(k, key, value) {
  const v = Number(value) || 0;
  const now = typeof k.time === "function" ? k.time() : 0;
  const c = _count.get(key);
  if (!c) { _count.set(key, { shown: v, t: now }); return v; }
  const dt = Math.min(0.1, Math.max(0, now - c.t)); c.t = now;
  if (Math.abs(v - c.shown) < 0.6) { c.shown = v; return v; }
  c.shown += (v - c.shown) * (1 - Math.exp(-dt * 7));
  return Math.round(c.shown);
}

export function entranceDy(k, openedT, i, { step = 0.03, dur = 0.22, from = 14 } = {}) {
  if (openedT == null || typeof k.time !== "function") return 0;
  const t = k.time() - openedT - i * step;
  if (t >= dur) return 0;
  if (t <= 0) return from;
  const p = t / dur, e = 1 - (1 - p) * (1 - p) * (1 - p);
  return (1 - e) * from;
}

export function drawCornerTicks(k, { rect, color = THEME.primary, opacity = 0.7, inset = 12, len = 14, width = 2, which = ["tl", "tr", "bl", "br"], fixed = false } = {}) {
  const [x, y, w, h] = rect;
  const c = k.rgb(...color);
  const all = { tl: [x + inset, y + inset, 1, 1], tr: [x + w - inset, y + inset, -1, 1], bl: [x + inset, y + h - inset, 1, -1], br: [x + w - inset, y + h - inset, -1, -1] };
  const corners = which.map((n) => all[n]).filter(Boolean);
  for (const [cx, cy, sx, sy] of corners) {
    k.drawLine({ p1: k.vec2(cx, cy), p2: k.vec2(cx + sx * len, cy), width, color: c, opacity, fixed });
    k.drawLine({ p1: k.vec2(cx, cy), p2: k.vec2(cx, cy + sy * len), width, color: c, opacity, fixed });
  }
}

export function drawIconTab(k, { x, y, size = 52, icon = "village", accent = THEME.primary, opacity = 1, fixed = false } = {}) {
  const r = Math.round(size * 0.3);
  k.drawRect({ pos: k.vec2(x, y + 4), width: size, height: size, radius: r, color: k.rgb(...THEME.bgAlt), opacity: 0.5 * opacity, fixed });
  k.drawRect({ pos: k.vec2(x, y), width: size, height: size, radius: r, color: k.rgb(...accent), opacity, gradient: buttonGradient(accent),
    outline: { width: 1, color: k.rgb(...darken(accent, 40)) }, fixed });
  k.drawRect({ pos: k.vec2(x + r * 0.7, y + 1.5), width: size - r * 1.4, height: 1.2, radius: 0.6, color: k.rgb(...lighten(accent, 90)), opacity: 0.55 * opacity, fixed });
  drawIcon(k, icon, { x: x + size / 2, y: y + size / 2, size: size * 0.52, color: THEME.textInv, opacity, weight: Math.max(2, size / 22), fixed });
  return [x, y, size, size];
}

export function drawMotes(k, { rect, color = THEME.teal, count = 12, t = null, opacity = 0.18, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  const now = t != null ? t : (typeof k.time === "function" ? k.time() : 0);
  const c = k.rgb(...color);
  for (let i = 0; i < count; i++) {
    const h1 = ((i * 7919) % 1000) / 1000, h2 = ((i * 104729) % 1000) / 1000, h3 = ((i * 1299709) % 1000) / 1000;
    const speed = 0.018 + h3 * 0.03;
    const py = y + h * (1 - ((h2 + now * speed) % 1));
    const px = x + w * h1 + Math.sin(now * 0.6 + i) * 8;
    const r = 1.2 + h3 * 1.8;
    const op = opacity * (0.5 + 0.5 * Math.sin(now * 1.3 + i * 1.7));
    k.drawCircle({ pos: k.vec2(px, py), radius: r, color: c, opacity: op, fixed });
  }
}

export function drawSweep(k, { rect, period = 7, width = 0.22, opacity = 0.07, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  const now = typeof k.time === "function" ? k.time() : 0;
  const p = (now % period) / period;
  if (p > 0.45) return;
  const c = Math.min(1.2, Math.max(-0.2, p / 0.45 * 1.4 - 0.2));
  const s0 = Math.max(0, c - width), s1 = Math.min(1, c + width);
  k.drawRect({ pos: k.vec2(x, y), width: w, height: h, color: k.rgb(...WHITE), opacity: 1,
    gradient: { dir: "h", stops: [[0, WHITE, 0], [s0, WHITE, 0], [Math.min(1, Math.max(0, c)), WHITE, opacity], [s1, WHITE, 0], [1, WHITE, 0]] }, fixed });
}

export function drawEmptyState(k, { rect, icon = "info", title = "", text = "", accent = THEME.primary, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  const cx = x + w / 2, cy = y + Math.min(h / 2, 120);
  k.drawCircle({ pos: k.vec2(cx, cy - 10), radius: 40, color: k.rgb(...accent), opacity: 0.1, fixed });
  drawIcon(k, icon, { x: cx, y: cy - 10, size: 40, color: accent, opacity: 0.8, fixed });
  if (title) k.drawText({ text: title, pos: k.vec2(cx, cy + 44), size: TYPE.h2, font: FONT_BOLD, anchor: "center", color: k.rgb(...THEME.text), fixed });
  if (text) k.drawText({ text, pos: k.vec2(cx, cy + 72), size: TYPE.small, font: FONT, anchor: "center", width: Math.min(w - 40, 420), align: "center", color: k.rgb(...THEME.textMut), fixed });
}

export const WHITE = [255, 255, 255];
export const GLASS = { fill: 0.05, fillHover: 0.09, fillPress: 0.13, line: 0.09, lineHover: 0.22, tint: 0.46 };

export function drawGlass(k, { rect, radius = 14, fill = GLASS.fill, line = GLASS.line, tint = 0, hover = false, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  if (tint > 0) k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius, color: k.rgb(...THEME.bg), opacity: tint, fixed });
  const f = hover ? Math.max(fill, GLASS.fillHover) : fill;
  if (f > 0) k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius, color: k.rgb(...WHITE), opacity: f, fixed });
  const l = hover ? Math.max(line, GLASS.lineHover) : line;
  if (l > 0) k.drawRect({ pos: k.vec2(x + 0.5, y + 0.5), width: w - 1, height: h - 1, radius: Math.max(0, radius - 0.5), color: k.rgb(...WHITE), opacity: l, fill: false, outline: { width: 1, color: k.rgb(...WHITE) }, fixed });
}
export function drawRow(k, { rect, radius = 14, hover = false, fixed = false } = {}) {
  drawGlass(k, { rect, radius, hover, fixed });
}
export function drawHairline(k, { x, y, w, opacity = 0.08, fixed = false } = {}) {
  k.drawRect({ pos: k.vec2(x, y), width: w, height: 1, color: k.rgb(...WHITE), opacity, fixed });
}
export function drawEyebrow(k, { x, y, text = "", size = 11, color = THEME.textMut, spacing = 2.2, anchor = "left", opacity = 1, fixed = false } = {}) {
  const s = String(text).toUpperCase();
  if (!s) return 0;
  const measure = typeof k.measureText === "function" ? (t) => k.measureText(t, size, FONT_BOLD) : (t) => t.length * size * 0.62;
  const widths = [...s].map((ch) => measure(ch));
  const total = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, widths.length - 1);
  let cx = anchor === "center" ? x - total / 2 : anchor === "right" ? x - total : x;
  const c = k.rgb(...color);
  [...s].forEach((ch, i) => { if (ch !== " ") k.drawText({ text: ch, pos: k.vec2(cx, y), size, font: FONT_BOLD, color: c, opacity, fixed }); cx += widths[i] + spacing; });
  return total;
}
export function drawChip(k, { x, y, text = "", color = THEME.textBody, size = 10, padX = 7, h = 18, anchor = "left", solid = false, fixed = false } = {}) {
  const s = String(text);
  const tw = typeof k.measureText === "function" ? k.measureText(s, size, FONT_BOLD) : s.length * size * 0.6;
  const w = Math.ceil(tw + padX * 2);
  const cx = anchor === "center" ? x - w / 2 : anchor === "right" ? x - w : x;
  const r = [cx, y, w, h];
  if (solid) k.drawRect({ pos: k.vec2(cx, y), width: w, height: h, radius: h / 2, color: k.rgb(...color), fixed });
  else {
    k.drawRect({ pos: k.vec2(cx, y), width: w, height: h, radius: h / 2, color: k.rgb(...color), opacity: 0.16, fixed });
    k.drawRect({ pos: k.vec2(cx + 0.5, y + 0.5), width: w - 1, height: h - 1, radius: h / 2, color: k.rgb(...color), opacity: 0.35, fill: false, outline: { width: 1, color: k.rgb(...color) }, fixed });
  }
  k.drawText({ text: s, pos: k.vec2(cx + w / 2, y + h / 2), size, font: FONT_BOLD, anchor: "center", color: k.rgb(...(solid ? THEME.textInv : color)), fixed });
  return r;
}
export function drawSwitch(k, { rect, on = false, hover = false, w = 46, h = 26, fixed = false } = {}) {
  const [rx, ry, rw, rh] = rect;
  const x = rx + rw - w, y = ry + (rh - h) / 2;
  if (on) k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: h / 2, color: k.rgb(...THEME.primary), gradient: buttonGradient(THEME.primary), fixed });
  else drawGlass(k, { rect: [x, y, w, h], radius: h / 2, fill: hover ? 0.12 : 0.08, line: hover ? 0.26 : 0.16, fixed });
  if (on && hover) k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: h / 2, color: k.rgb(...WHITE), opacity: 0.1, fixed });
  const kr = h / 2 - 3, kx = on ? x + w - 3 - kr : x + 3 + kr;
  k.drawCircle({ pos: k.vec2(kx, y + h / 2 + 1), radius: kr, color: k.rgb(...THEME.bgAlt), opacity: 0.35, fixed });
  k.drawCircle({ pos: k.vec2(kx, y + h / 2), radius: kr, color: k.rgb(...(on ? WHITE : THEME.textBody)), fixed });
  return [x, y, w, h];
}
export function drawSegments(k, { rect, options = [], active, pointer = null, size = 12, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  drawGlass(k, { rect, radius: h / 2, fill: 0.05, line: 0.12, fixed });
  const n = Math.max(1, options.length), sw = (w - 4) / n, out = [];
  options.forEach(([id, label], i) => {
    const r = [x + 2 + i * sw, y + 2, sw, h - 4];
    const on = id === active, hov = pointer ? inRect(pointer, r) : false;
    if (on) k.drawRect({ pos: k.vec2(r[0], r[1]), width: r[2], height: r[3], radius: r[3] / 2, color: k.rgb(...THEME.primary), gradient: buttonGradient(THEME.primary), fixed });
    else if (hov) k.drawRect({ pos: k.vec2(r[0], r[1]), width: r[2], height: r[3], radius: r[3] / 2, color: k.rgb(...WHITE), opacity: 0.08, fixed });
    k.drawText({ text: label, pos: k.vec2(r[0] + r[2] / 2, r[1] + r[3] / 2), size, font: FONT_BOLD, anchor: "center", color: k.rgb(...(on ? WHITE : hov ? THEME.text : THEME.textBody)), fixed });
    out.push({ id, r });
  });
  return out;
}
export function drawMeter(k, { rect, frac = 0, color = THEME.primary, radius = null, fixed = false } = {}) {
  const [x, y, w, h] = rect, r = radius == null ? h / 2 : radius;
  k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius: r, color: k.rgb(...WHITE), opacity: 0.1, fixed });
  const f = Math.max(0, Math.min(1, frac));
  if (f > 0) k.drawRect({ pos: k.vec2(x, y), width: Math.max(h, w * f), height: h, radius: r, color: k.rgb(...color), fixed });
}

const _tabAnim = new Map();
export function drawTabs(k, { rect, tabs = [], active, pointer = null, size = 14, accent = THEME.primary, animKey = null, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  const col = (t) => k.rgb(...t);
  const n = Math.max(1, tabs.length), tw = w / n;
  drawHairline(k, { x, y: y + h - 1, w, opacity: 0.08, fixed });
  const out = [];
  let target = null;
  tabs.forEach((tab, i) => {
    const [id, label, icon] = tab;
    const r = [x + i * tw, y, tw, h];
    const on = id === active, hov = pointer ? inRect(pointer, r) : false;
    if (hov && !on) k.drawRect({ pos: k.vec2(r[0] + 4, r[1] + 3), width: r[2] - 8, height: r[3] - 9, radius: 10, color: col(WHITE), opacity: 0.06, fixed });
    const textW = typeof k.measureText === "function" ? k.measureText(label, size, FONT_BOLD) : label.length * size * 0.6;
    const iconW = icon ? size + 8 : 0;
    const cx = r[0] + r[2] / 2, cy = r[1] + (r[3] - 3) / 2;
    const ink = on ? THEME.text : hov ? THEME.textBody : THEME.textMut;
    if (icon) drawIcon(k, icon, { x: cx - textW / 2 - 2, y: cy, size: size + 2, color: on ? accent : ink, fixed });
    k.drawText({ text: label, pos: k.vec2(cx + iconW / 2, cy), size, font: FONT_BOLD, anchor: "center", color: col(ink), fixed });
    if (on) target = { x: r[0] + (r[2] - Math.min(r[2] - 16, textW + iconW + 14)) / 2, w: Math.min(r[2] - 16, textW + iconW + 14) };
    out.push({ id, r });
  });
  if (target) {
    let cur = target;
    if (animKey) {
      const now = typeof k.time === "function" ? k.time() : 0;
      const a = _tabAnim.get(animKey);
      if (!a || Math.abs(a.y - y) > 1) { _tabAnim.set(animKey, { x: target.x, w: target.w, y, t: now }); cur = target; }
      else { const dt = Math.min(0.1, Math.max(0, now - a.t)); const f = 1 - Math.exp(-dt * 16); a.x += (target.x - a.x) * f; a.w += (target.w - a.w) * f; a.t = now; cur = a; }
    }
    k.drawRect({ pos: k.vec2(cur.x, y + h - 3), width: cur.w, height: 3, radius: 1.5, color: col(accent), fixed });
  }
  return out;
}

export function drawCard(k, { rect, accent = THEME.neutral, hover = false, selected = false, radius = 14, glowY = 0.38, fixed = false } = {}) {
  const col = (t) => k.rgb(...t);
  const L = hover ? 3 : 0;
  const [x, y, w, h] = [rect[0] - L, rect[1] - L, rect[2] + L * 2, rect[3] + L * 2];
  if (hover) k.drawRect({ pos: k.vec2(x, y + 4), width: w, height: h, radius, color: col(THEME.bgAlt), opacity: 0.35, fixed });
  k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius, color: col(THEME.bg), opacity: 0.38, fixed });
  k.drawRect({ pos: k.vec2(x, y), width: w, height: h, radius, color: col(WHITE), opacity: hover || selected ? 0.08 : 0.045, fixed });
  k.drawRect({ pos: k.vec2(x + 1, y + 1), width: w - 2, height: h - 2, radius: radius - 1, color: col(accent), opacity: 1,
    gradient: { dir: "radial", cx: 0.5, cy: glowY, r: Math.max(w, h) * 0.55, stops: [[0, accent, selected ? 0.3 : 0.2], [0.6, accent, 0.05], [1, accent, 0]] }, fixed });
  if (selected) k.drawRect({ pos: k.vec2(x + 1, y + 1), width: w - 2, height: h - 2, radius: radius - 1, color: col(THEME.primary), fill: false, outline: { width: 2, color: col(THEME.primary) }, fixed });
  else k.drawRect({ pos: k.vec2(x + 0.5, y + 0.5), width: w - 1, height: h - 1, radius: radius - 0.5, color: col(WHITE), opacity: hover ? GLASS.lineHover : GLASS.line, fill: false, outline: { width: 1, color: col(WHITE) }, fixed });
}

export function drawCardPlate(k, { rect, h = 30, inset = 6, radius = 8, opacity = 0.62, fixed = false } = {}) {
  const [x, y, w, ch] = rect;
  const r = [x + inset, y + ch - h - inset, w - inset * 2, h];
  k.drawRect({ pos: k.vec2(r[0], r[1]), width: r[2], height: r[3], radius, color: k.rgb(...THEME.bg), opacity,
    gradient: { dir: "v", stops: [[0, THEME.bg, opacity * 0.8], [1, THEME.bgAlt, opacity]] }, fixed });
  return r;
}


export function drawCloseX(k, { rect, hover = false, fixed = false } = {}) {
  const [x, y, w, h] = rect;
  const col = (t) => k.rgb(...t);
  drawButton(k, { rect, text: "", fill: THEME.surfaceAlt, radius: Math.min(w, h) / 2, hover, fixed });
  void col;
  drawIcon(k, "close", { x: x + w / 2, y: y + h / 2, size: Math.min(w, h) * 0.46, color: hover ? THEME.text : THEME.textBody, weight: 2.2, fixed });
}


export function drawOrnamentRule(k, { x, y, w = 160, color = THEME.teal, anchor = "left", fixed = false } = {}) {
  const x0 = anchor === "center" ? x - w / 2 : x;
  k.drawRect({ pos: k.vec2(x0, y), width: w, height: 2, radius: 1, color: k.rgb(...color), opacity: 1,
    gradient: { dir: "h", stops: anchor === "center" ? [[0, color, 0], [0.5, color, 1], [1, color, 0]] : [[0, color, 1], [0.6, color, 0.7], [1, color, 0]] }, fixed });
  k.drawRect({ pos: k.vec2(x0 + (anchor === "center" ? w / 2 - 14 : 0), y - 1), width: 28, height: 4, radius: 2, color: k.rgb(...lighten(color, 60)), opacity: 0.001,
    shadow: { blur: 8, color, alpha: 0.9 }, fixed });
}

export function drawHeader(k, { x = 20, y = 16, title = "", size = 25, ruleW = 150, color = THEME.text, fixed = true } = {}) {
  const col = (t) => k.rgb(...t);
  k.drawText({ text: title, pos: k.vec2(x, y), size, font: FONT_BOLD, color: col(color), fixed });
  const ry = y + size + 4;
  k.drawRect({ pos: k.vec2(x, ry + 2), width: ruleW, height: 2, radius: 1, color: col(THEME.teal), opacity: 1,
    gradient: { dir: "h", stops: [[0, THEME.teal, 1], [0.6, THEME.teal, 0.7], [1, THEME.teal, 0]] }, fixed });
  return ry + 6;
}

export function drawScrollbar(k, { top, trackH, contentH, scrollY, maxScroll, x, w = 5,
  color = THEME.textMut, track = true } = {}) {
  if (!(maxScroll > 0) || !(contentH > 0)) return;
  const thumbH = Math.max(30, (trackH * trackH) / contentH);
  const thumbY = top + (scrollY / maxScroll) * (trackH - thumbH);
  const px = x != null ? x : k.width() - 7;
  const col = (t) => k.rgb(...t);
  if (track) k.drawRect({ pos: k.vec2(px, top), width: w, height: trackH, radius: w / 2, color: col(THEME.lineSoft), opacity: 0.6, fixed: true });
  k.drawRect({ pos: k.vec2(px, thumbY), width: w, height: thumbH, radius: w / 2, color: col(color), fixed: true });
}

export function drawToast(k, { text, t, color = THEME.text, size = 13 } = {}) {
  if (!(t > 0) || !text) return;
  const op = Math.min(1, t / 0.4);
  const tw = Math.min(k.width() - 40, size * text.length + 36);
  const x = k.width() / 2, y = k.height() - 44;
  drawPanel(k, { rect: [x - tw / 2, y - 15, tw, 30], radius: 8, opacity: op, fixed: true });
  k.drawText({ text, pos: k.vec2(x, y), size, font: FONT, anchor: "center", color: k.rgb(...color), opacity: op, fixed: true });
}

export const fmtCurrency = (n) => String(Math.floor(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export const CURRENCY_HUE = { gold: THEME.amber, essence: THEME.violet };

export function drawCurrency(k, { x, y, items = [], size = 13, gap = 16, pip = 4, anchor = "left", animKey = null, fixed = true } = {}) {
  const col = (t) => k.rgb(...t);
  const chW = size * 0.6;
  const list = items
    .filter((it) => it && it.value != null)
    .map((it) => {
      const color = it.color || CURRENCY_HUE[it.kind] || THEME.text;
      const text = fmtCurrency(animKey ? countUp(k, `${animKey}:${it.kind || it.color}`, it.value) : it.value);
      return { kind: it.kind, color, text, w: pip * 2 + 6 + text.length * chW };
    });
  const total = list.reduce((s, it) => s + it.w, 0) + gap * Math.max(0, list.length - 1);
  let cx = anchor === "right" ? x - total : anchor === "center" ? x - total / 2 : x;
  for (const it of list) {
    drawCurrencyIcon(k, it.kind, { x: cx + pip, y, r: pip, color: it.color, fixed });
    k.drawText({ text: it.text, pos: k.vec2(cx + pip * 2 + 6, y), anchor: "left-center", size, font: FONT, color: col(it.color), fixed });
    cx += it.w + gap;
  }
  return { width: total };
}

export function drawWalletPill(k, { x, y, items = [], size = 15, anchor = "right", fixed = true } = {}) {
  const PIP = 5, GAP = 18, padX = 14, pillH = 34, chW = size * 0.6;
  const list = items.filter((it) => it && it.value != null);
  const contentW = list.reduce((s, it) => s + PIP * 2 + 6 + fmtCurrency(it.value).length * chW, 0) + GAP * Math.max(0, list.length - 1);
  const pillW = contentW + padX * 2;
  const px = anchor === "right" ? x - pillW : anchor === "center" ? x - pillW / 2 : x;
  const py = y - pillH / 2;
  drawPanel(k, { rect: [px, py, pillW, pillH], radius: pillH / 2, fill: THEME.surfaceAlt, border: THEME.line, borderW: 1, fixed });
  drawCurrency(k, { x: px + padX, y, anchor: "left", size, pip: PIP, gap: GAP, items: list, fixed });
  return [px, py, pillW, pillH];
}

const MENU_BG_W = 1280, MENU_BG_H = 720;

// Text bakes glyphs at creation: re-render once webfonts load (one-shot).
let _fontReflowArmed = false;
function armFontReflow(k) {
  if (_fontReflowArmed) return;
  _fontReflowArmed = true;
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    if (document.fonts.check("40px gameFont") && document.fonts.check("40px gameFontBody") && document.fonts.check("40px gameFontBold")) return;
  } catch { return; }
  document.fonts.ready.then(() => {
    try { if (k._lastGo) k.go(k._lastGo.name, k._lastGo.data); } catch {}
  });
}

export function addMenuBackground(k, { fixed = false, z } = {}) {
  armFontReflow(k);
  const cover = Math.max(k.width() / MENU_BG_W, k.height() / MENU_BG_H);
  const comps = [k.sprite("menu_background"), k.pos(k.width() / 2, k.height() / 2),
    k.anchor("center"), k.scale(cover)];
  if (z != null) comps.push(k.z(z));
  if (fixed) comps.push(k.fixed());
  const bg = k.add(comps);
  const W = k.width(), H = k.height();
  const vig = [k.rect(W, H, { gradient: { dir: "radial", r: Math.hypot(W, H) * 0.56, stops: [[0, [0, 0, 0], 0], [0.6, [0, 0, 0], 0.18], [1, [0, 0, 0], 0.62]] } }),
    k.pos(W / 2, H / 2), k.anchor("center"), k.color(0, 0, 0)];
  const haze = [k.rect(W, H * 0.55, { gradient: { dir: "v", stops: [[0, THEME.teal, 0.07], [1, THEME.teal, 0]] } }),
    k.pos(W / 2, 0), k.anchor("top"), k.color(...THEME.teal)];
  if (z != null) { vig.push(k.z(z)); haze.push(k.z(z)); }
  if (fixed) { vig.push(k.fixed()); haze.push(k.fixed()); }
  k.add(haze); k.add(vig);
  if (!fixed && z == null) addMenuMotes(k);
  return bg;
}

export function addMenuMotes(k, { count = 18, color = THEME.teal } = {}) {
  const W = k.width(), H = k.height(), motes = [];
  for (let i = 0; i < count; i++) {
    const s = 2 + Math.random() * 3, px = Math.random() * W, py = Math.random() * H;
    const obj = k.add([k.rect(s, s, { radius: s / 2 }), k.pos(px, py), k.anchor("center"),
      k.color(color[0], color[1], color[2]), k.opacity(0.08 + Math.random() * 0.14)]);
    motes.push({ obj, baseX: px, vy: 6 + Math.random() * 10, amp: 6 + Math.random() * 10, phase: Math.random() * Math.PI * 2 });
  }
  if (!prefersReducedMotion()) k.onUpdate(() => {
    const t = k.time(), dt = k.dt();
    for (const m of motes) {
      let y = m.obj.pos.y - m.vy * dt;
      if (y < -6) { y = H + 6; m.baseX = Math.random() * W; }
      m.obj.pos = k.vec2(m.baseX + Math.sin(t * 0.6 + m.phase) * m.amp, y);
    }
  });
  return motes;
}

export function addHeader(k, { x, y = 46, text, size = 34, sub, color = THEME.text, ruleW = 190 } = {}) {
  const W = typeof k.width === "function" ? k.width() : 1280;
  const narrow = W < 560;
  const avail = narrow ? W - 220 : W - 40;
  if (text && text.length) size = Math.max(12, Math.min(size, Math.floor(avail / (text.length * 0.75))));
  ruleW = Math.min(ruleW, W - 40);
  const label = addLabel(k, { x, y, text, size, color, font: FONT_BOLD });
  const ry = y + size * 0.8;
  k.add([k.rect(ruleW, 2, { radius: 1, gradient: { dir: "h", stops: [[0, THEME.teal, 0], [0.5, THEME.teal, 1], [1, THEME.teal, 0]] } }), k.pos(x, ry), k.anchor("center"), k.color(...THEME.teal)]);
  k.add([k.rect(28, 4, { radius: 2, shadow: { blur: 10, color: THEME.teal, alpha: 0.9 } }), k.pos(x, ry), k.anchor("center"), k.color(...lighten(THEME.teal, 60)), k.opacity(0.001)]);
  if (sub) addLabel(k, { x, y: ry + 20, text: sub, size: 14, color: THEME.textMut });
  return label;
}

export function addLabel(k, { x, y, text, size = 22, anchor = "center",
  color = THEME.text, width, align, fixed = false, opacity = 1, font = FONT, tag } = {}) {
  const comps = [
    k.text(text, { size, font, ...(width ? { width } : {}), ...(align ? { align } : {}) }),
    k.pos(x, y), k.anchor(anchor), k.color(...color), k.opacity(opacity),
  ];
  if (fixed) comps.push(k.fixed());
  if (tag) comps.push(tag);
  return k.add(comps);
}
