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
export function touchPrimary(k) {
  if (!hasTouch(k)) return false;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    try {
      const fine = window.matchMedia("(any-pointer: fine)").matches;     // a mouse / trackpad / stylus exists
      const coarse = window.matchMedia("(any-pointer: coarse)").matches; // a touchscreen exists
      if (coarse || fine) return coarse && !fine;                        // any-pointer supported → touch-only device
      // Very old engine without any-pointer: fall back to the primary-pointer signal.
      if (window.matchMedia("(pointer: fine)").matches) return false;
      if (window.matchMedia("(pointer: coarse)").matches) return true;
    } catch { /* ancient matchMedia */ }
  }
  return true; // no matchMedia at all: a touch capability is the best signal left
}

// Shared joystick radius (kept identical across scenes).
export const JOY_R = 70;

// The standardized floating virtual joystick. `base` is where the ring is drawn (under the
// thumb while dragging, or the discoverable rest slot when idle); `thumb` is the knob.
// `active` = a finger/mouse is currently driving it. Theme-driven so it matches the rest of
// the UI and follows palette changes.
export function drawJoystick(k, { base, thumb, active = false, radius = JOY_R }) {
  k.drawCircle({ pos: base, radius, color: k.rgb(...THEME.surface), opacity: active ? 0.22 : 0.10, fixed: true });
  k.drawCircle({ pos: base, radius, fill: false, outline: { width: active ? 3 : 2, color: k.rgb(...THEME.line) }, opacity: active ? 0.60 : 0.24, fixed: true });
  const t = active ? thumb : base;
  k.drawCircle({ pos: t, radius: active ? 30 : 24, color: k.rgb(...THEME.teal), opacity: active ? 0.70 : 0.20, fixed: true });
  if (active) k.drawCircle({ pos: t, radius: 30, fill: false, outline: { width: 2, color: k.rgb(...THEME.teal) }, opacity: 0.85, fixed: true });
}

// A standardized circular touch action button (the hub "USE" prompt, the in-run "THROW").
// `accent` themes it per context; `enabled=false` dims it (e.g. THROW with no chain equipped).
export function drawTouchButton(k, { pos, radius = 46, label, sub = null, accent = THEME.teal, enabled = true }) {
  const op = enabled ? 1 : 0.42;
  k.drawCircle({ pos, radius: radius + 4, color: k.rgb(...accent), opacity: 0.18 * op, fixed: true }); // halo so it pops off the world
  k.drawCircle({ pos, radius, color: k.rgb(...THEME.bgAlt), opacity: enabled ? 0.92 : 0.6, outline: { width: 2, color: k.rgb(...accent) }, fixed: true });
  k.drawText({ text: label, pos: k.vec2(pos.x, pos.y - (sub ? 8 : 0)), size: 15, font: FONT, anchor: "center", color: k.rgb(...accent), opacity: op, fixed: true });
  if (sub) k.drawText({ text: sub, pos: k.vec2(pos.x, pos.y + 9), size: 10, font: FONT, anchor: "center", color: k.rgb(...THEME.textMut), opacity: op, fixed: true });
}
