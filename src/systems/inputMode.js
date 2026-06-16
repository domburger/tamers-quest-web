// Single source of truth for touch input + the shared renderers for the on-screen
// (virtual) controls, so every walkable scene (the hub village + the in-run overworld)
// detects mobile the same way and draws an IDENTICAL joystick / action button.
// "Fix once": change the look or the gating here and it changes everywhere.
//
// Two questions are deliberately kept SEPARATE — conflating them is the bug this module
// exists to kill:
//   • hasTouch(k)     — does this device have a touchscreen AT ALL? Used to suppress
//                       sticky :hover glows after a tap and to lower the particle budget.
//   • touchPrimary(k) — is touch the PRIMARY way this user drives the game? ONLY then do we
//                       overlay a virtual joystick + action buttons. A Windows 2-in-1, a
//                       touchscreen laptop, or a touch desktop monitor all expose a touch
//                       capability yet are driven by a mouse + keyboard — they must NOT get
//                       a thumb-stick painted over the screen, and they keep mouse-drag move.
//
// `(pointer: coarse)` matches when the *primary* pointing device is a finger — exactly
// "phone / tablet", and false on desktops even with an attached touchscreen (a mouse /
// trackpad reports `(pointer: fine)`). That is the standard, W3C-blessed signal here.

import { THEME, FONT } from "../ui/theme.js";

// Touch hardware is present (capability only — says nothing about the primary input).
export function hasTouch(k) {
  try { if (typeof k?.isTouchscreen === "function" && k.isTouchscreen()) return true; } catch { /* shim not ready */ }
  if (typeof window !== "undefined" && "ontouchstart" in window) return true;
  if (typeof navigator !== "undefined" && (navigator.maxTouchPoints || 0) > 0) return true;
  return false;
}

// This is a phone/tablet (touchscreen present, NO mouse/trackpad) → SHOW the on-screen controls.
//
// The decisive test is `(any-pointer: fine)`: it's true whenever ANY precise pointer (a mouse,
// a trackpad, a stylus) is wired up. A desktop or laptop ALWAYS has one — even a touchscreen
// laptop or a touch-enabled all-in-one — so the on-screen stick must never show there. A real
// phone/tablet has only a coarse pointer and no fine one. (An earlier "(pointer: coarse) is the
// primary" check leaked on Windows touch machines that report a coarse primary; this doesn't.)
// Perf: cache the MediaQueryList per query. window.matchMedia(query) re-parses the query string +
// allocates a fresh MQL every call, and touchPrimary() runs PER FRAME in the walkable/management
// scenes (the on-screen-controls gate, e.g. roster onDraw). The cached MQL's `.matches` stays LIVE —
// the browser keeps it updated — so a newly-attached mouse still flips the result; we only stop the
// per-frame re-parse + allocation. (Falls back to a direct call if caching ever throws.)
const _mqCache = new Map();
let _mqImpl = null;
function mqMatches(query) {
  // If window.matchMedia was swapped (test harnesses install a fresh mock per case), drop the cache so
  // we never read a stale MQL. In production matchMedia is stable forever, so this is one cheap
  // reference compare per call and the cached MQLs persist (no per-frame query re-parse).
  if (window.matchMedia !== _mqImpl) { _mqImpl = window.matchMedia; _mqCache.clear(); }
  let m = _mqCache.get(query);
  if (m === undefined) { m = window.matchMedia(query); _mqCache.set(query, m); }
  return m.matches;
}

export function touchPrimary(k) {
  if (!hasTouch(k)) return false;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    try {
      const fine = mqMatches("(any-pointer: fine)");     // a mouse / trackpad / stylus exists
      const coarse = mqMatches("(any-pointer: coarse)"); // a touchscreen exists
      if (coarse || fine) return coarse && !fine;        // any-pointer supported → touch-only device
      // Very old engine without any-pointer: fall back to the primary-pointer signal.
      if (mqMatches("(pointer: fine)")) return false;
      if (mqMatches("(pointer: coarse)")) return true;
    } catch { /* ancient matchMedia */ }
  }
  return true; // no matchMedia at all: a touch capability is the best signal left
}

// Shared joystick radius (kept identical across scenes). TQ-526: enlarged for the reworked
// mobile controls (bigger, easier thumb target).
export const JOY_R = 88;

// The standardized floating virtual joystick. `base` is where the ring is drawn (under the
// thumb while dragging, or the discoverable rest slot when idle); `thumb` is the knob.
// `active` = a finger/mouse is currently driving it. Theme-driven so it matches the rest of
// the UI and follows palette changes. TQ-526: deeper well + glowing accent knob + inner guide ring.
export function drawJoystick(k, { base, thumb, active = false, radius = JOY_R }) {
  k.drawCircle({ pos: base, radius: radius + 5, color: k.rgb(...THEME.teal), opacity: active ? 0.10 : 0.05, fixed: true }); // soft outer bloom
  k.drawCircle({ pos: base, radius, color: k.rgb(...THEME.bgAlt), opacity: active ? 0.46 : 0.24, fixed: true });            // well
  k.drawCircle({ pos: base, radius, fill: false, outline: { width: active ? 4 : 3, color: k.rgb(...THEME.line) }, opacity: active ? 0.72 : 0.36, fixed: true });
  k.drawCircle({ pos: base, radius: radius * 0.52, fill: false, outline: { width: 2, color: k.rgb(...THEME.line) }, opacity: active ? 0.42 : 0.16, fixed: true }); // inner guide
  const t = active ? thumb : base;
  const kr = active ? radius * 0.5 : radius * 0.42;
  k.drawCircle({ pos: t, radius: kr + 7, color: k.rgb(...THEME.teal), opacity: active ? 0.30 : 0.12, fixed: true });        // knob glow
  k.drawCircle({ pos: t, radius: kr, color: k.rgb(...THEME.teal), opacity: active ? 0.92 : 0.38, fixed: true });
  k.drawCircle({ pos: t, radius: kr, fill: false, outline: { width: 2.5, color: k.rgb(...THEME.text) }, opacity: active ? 0.6 : 0.28, fixed: true }); // bright rim
}

// A standardized circular touch action button (the hub "USE" prompt, the in-run "SWAP").
// `accent` themes it per context; `enabled=false` dims it. TQ-526: bigger + glow halo + inner hairline.
export function drawTouchButton(k, { pos, radius = 52, label, sub = null, accent = THEME.teal, enabled = true }) {
  const op = enabled ? 1 : 0.42;
  k.drawCircle({ pos, radius: radius + 7, color: k.rgb(...accent), opacity: 0.16 * op, fixed: true }); // glow halo so it pops off the world
  k.drawCircle({ pos, radius, color: k.rgb(...THEME.bgAlt), opacity: enabled ? 0.95 : 0.62, fixed: true });
  k.drawCircle({ pos, radius, fill: false, outline: { width: 3, color: k.rgb(...accent) }, opacity: 0.9 * op, fixed: true });
  k.drawCircle({ pos, radius: radius - 5, fill: false, outline: { width: 1, color: k.rgb(...accent) }, opacity: 0.28 * op, fixed: true }); // inner hairline
  k.drawText({ text: label, pos: k.vec2(pos.x, pos.y - (sub ? 9 : 0)), size: 17, font: FONT, anchor: "center", color: k.rgb(...accent), opacity: op, fixed: true });
  if (sub) k.drawText({ text: sub, pos: k.vec2(pos.x, pos.y + 11), size: 11, font: FONT, anchor: "center", color: k.rgb(...THEME.textMut), opacity: op, fixed: true });
}

// TQ-526: the floating THROW pad. Spawns wherever the right-half touch lands (`origin`); the knob is
// pulled toward `dir` while dragging, with a directional arrow + a charge ring (TQ-450 hold-to-charge).
// `enabled=false` (no chain / chain still out) dims it. Self-contained so the overworld just hands it state.
export function drawThrowPad(k, { origin, dir = { x: 0, y: 0 }, dragged = false, charge = 0, accent = THEME.water, enabled = true, radius = 66 }) {
  const op = enabled ? 1 : 0.4;
  k.drawCircle({ pos: origin, radius, color: k.rgb(...THEME.bgAlt), opacity: 0.36 * op, fixed: true });                                  // well
  k.drawCircle({ pos: origin, radius, fill: false, outline: { width: 3, color: k.rgb(...accent) }, opacity: 0.55 * op, fixed: true });
  if (charge > 0.02) k.drawCircle({ pos: origin, radius: radius + 7, fill: false, outline: { width: 2 + charge * 4, color: k.rgb(...accent) }, opacity: 0.35 + 0.55 * charge, fixed: true }); // charge ring
  const pull = dragged ? radius * 0.66 : 0, kx = origin.x + dir.x * pull, ky = origin.y + dir.y * pull, kr = radius * 0.4;
  k.drawCircle({ pos: k.vec2(kx, ky), radius: kr + 6, color: k.rgb(...accent), opacity: 0.22 * op, fixed: true });                       // knob glow
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
