import { drawIcon } from "../ui/icons.js";
import { THEME, FONT } from "../ui/theme.js";

export function hasTouch(k) {
  try { if (typeof k?.isTouchscreen === "function" && k.isTouchscreen()) return true; } catch {}
  if (typeof window !== "undefined" && "ontouchstart" in window) return true;
  if (typeof navigator !== "undefined" && (navigator.maxTouchPoints || 0) > 0) return true;
  return false;
}

// Use any-pointer: fine; (pointer: coarse) misfires on Windows touch laptops.
const _mqCache = new Map();
let _mqImpl = null;
function mqMatches(query) {
  if (window.matchMedia !== _mqImpl) { _mqImpl = window.matchMedia; _mqCache.clear(); }
  let m = _mqCache.get(query);
  if (m === undefined) { m = window.matchMedia(query); _mqCache.set(query, m); }
  return m.matches;
}

export function touchPrimary(k) {
  if (!hasTouch(k)) return false;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    try {
      const fine = mqMatches("(any-pointer: fine)");
      const coarse = mqMatches("(any-pointer: coarse)");
      if (coarse || fine) return coarse && !fine;
      if (mqMatches("(pointer: fine)")) return false;
      if (mqMatches("(pointer: coarse)")) return true;
    } catch {}
  }
  return true;
}

export const JOY_R = 88;

export function drawJoystick(k, { base, thumb, active = false, radius = JOY_R }) {
  k.drawCircle({ pos: base, radius: radius + 5, color: k.rgb(...THEME.teal), opacity: active ? 0.10 : 0.05, fixed: true });
  k.drawCircle({ pos: base, radius, color: k.rgb(...THEME.bg), opacity: active ? 0.5 : 0.3, fixed: true });
  k.drawCircle({ pos: base, radius, color: k.rgb(255, 255, 255), opacity: active ? 0.07 : 0.04, fixed: true });
  k.drawCircle({ pos: base, radius, fill: false, outline: { width: 1.5, color: k.rgb(255, 255, 255) }, opacity: active ? 0.3 : 0.16, fixed: true });
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2, r0 = radius * 0.78, r1 = radius * 0.9; k.drawLine({ p1: k.vec2(base.x + Math.cos(a) * r0, base.y + Math.sin(a) * r0), p2: k.vec2(base.x + Math.cos(a) * r1, base.y + Math.sin(a) * r1), width: 2, color: k.rgb(255, 255, 255), opacity: active ? 0.3 : 0.14, fixed: true }); }
  const t = active ? thumb : base;
  const kr = active ? radius * 0.5 : radius * 0.42;
  k.drawCircle({ pos: t, radius: kr + 7, color: k.rgb(...THEME.teal), opacity: active ? 0.30 : 0.12, fixed: true });
  k.drawCircle({ pos: t, radius: kr, color: k.rgb(...THEME.teal), opacity: active ? 0.92 : 0.38, fixed: true });
  k.drawCircle({ pos: t, radius: kr, fill: false, outline: { width: 2.5, color: k.rgb(...THEME.text) }, opacity: active ? 0.6 : 0.28, fixed: true });
}

export function drawTouchButton(k, { pos, radius = 52, label, sub = null, accent = THEME.teal, enabled = true, icon = null }) {
  const op = enabled ? 1 : 0.42;
  k.drawCircle({ pos, radius: radius + 7, color: k.rgb(...accent), opacity: 0.16 * op, fixed: true });
  k.drawCircle({ pos, radius, color: k.rgb(...THEME.bgAlt), opacity: enabled ? 0.92 : 0.62, fixed: true });
  k.drawCircle({ pos, radius, color: k.rgb(...accent), opacity: 0.1 * op, fixed: true });
  k.drawCircle({ pos, radius, fill: false, outline: { width: 3, color: k.rgb(...accent) }, opacity: 0.9 * op, fixed: true });
  k.drawCircle({ pos, radius: radius - 5, fill: false, outline: { width: 1, color: k.rgb(...accent) }, opacity: 0.28 * op, fixed: true });
  const hasIcon = !!icon;
  if (hasIcon) drawIcon(k, icon, { x: pos.x, y: pos.y - (sub ? 16 : 11), size: Math.round(radius * 0.46), color: accent, opacity: op, weight: 2.4, fixed: true });
  k.drawText({ text: label, pos: k.vec2(pos.x, pos.y + (hasIcon ? (sub ? 6 : 12) : (sub ? -9 : 0))), size: hasIcon ? 14 : 17, font: FONT, anchor: "center", color: k.rgb(...accent), opacity: op, fixed: true });
  if (sub) k.drawText({ text: sub, pos: k.vec2(pos.x, pos.y + (hasIcon ? 21 : 11)), size: 11, font: FONT, anchor: "center", color: k.rgb(...THEME.textMut), opacity: op, fixed: true });
}

export function drawThrowPad(k, { origin, dir = { x: 0, y: 0 }, dragged = false, charge = 0, accent = THEME.water, enabled = true, radius = 66 }) {
  const op = enabled ? 1 : 0.4;
  k.drawCircle({ pos: origin, radius, color: k.rgb(...THEME.bgAlt), opacity: 0.36 * op, fixed: true });
  k.drawCircle({ pos: origin, radius, fill: false, outline: { width: 3, color: k.rgb(...accent) }, opacity: 0.55 * op, fixed: true });
  if (charge > 0.02) k.drawCircle({ pos: origin, radius: radius + 7, fill: false, outline: { width: 2 + charge * 4, color: k.rgb(...accent) }, opacity: 0.35 + 0.55 * charge, fixed: true });
  const pull = dragged ? radius * 0.66 : 0, kx = origin.x + dir.x * pull, ky = origin.y + dir.y * pull, kr = radius * 0.4;
  k.drawCircle({ pos: k.vec2(kx, ky), radius: kr + 6, color: k.rgb(...accent), opacity: 0.22 * op, fixed: true });
  k.drawCircle({ pos: k.vec2(kx, ky), radius: kr, color: k.rgb(...accent), opacity: 0.9 * op, fixed: true });
  k.drawCircle({ pos: k.vec2(kx, ky), radius: kr, fill: false, outline: { width: 2, color: k.rgb(...THEME.text) }, opacity: 0.5 * op, fixed: true });
  if (dragged) {
    const tip = k.vec2(origin.x + dir.x * (radius + 30), origin.y + dir.y * (radius + 30));
    const ang = Math.atan2(dir.y, dir.x), h = 15, a1 = ang + Math.PI * 0.82, a2 = ang - Math.PI * 0.82;
    const b = k.vec2(origin.x + dir.x * (radius + 4), origin.y + dir.y * (radius + 4));
    k.drawLine({ p1: b, p2: tip, width: 5, color: k.rgb(...accent), opacity: 0.9, fixed: true });
    k.drawLine({ p1: tip, p2: k.vec2(tip.x + Math.cos(a1) * h, tip.y + Math.sin(a1) * h), width: 5, color: k.rgb(...accent), opacity: 0.9, fixed: true });
    k.drawLine({ p1: tip, p2: k.vec2(tip.x + Math.cos(a2) * h, tip.y + Math.sin(a2) * h), width: 5, color: k.rgb(...accent), opacity: 0.9, fixed: true });
  }
}
