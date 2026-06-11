import { test } from "node:test";
import assert from "node:assert/strict";
import { hasTouch, touchPrimary } from "./inputMode.js";

// Helper: stand up a fake browser env (window + navigator) for one assertion, then restore.
// `navigator` is a read-only getter on the Node global, so swap it via defineProperty.
function setNavigator(value) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
  return () => { if (prev) Object.defineProperty(globalThis, "navigator", prev); else delete globalThis.navigator; };
}
function withEnv({ ontouchstart = false, maxTouchPoints = 0, media = {}, noMatchMedia = false } = {}, fn) {
  const prevWin = global.window;
  const win = {};
  if (ontouchstart) win.ontouchstart = null; // presence is what's tested ("ontouchstart" in window)
  if (!noMatchMedia) win.matchMedia = (q) => ({ matches: !!media[q] });
  global.window = win;
  const restoreNav = setNavigator({ maxTouchPoints });
  try { return fn(); } finally { global.window = prevWin; restoreNav(); }
}

test("hasTouch: false on a plain desktop (no touch APIs)", () => {
  withEnv({}, () => assert.equal(hasTouch(), false));
});

test("hasTouch: true when ontouchstart exists", () => {
  withEnv({ ontouchstart: true }, () => assert.equal(hasTouch(), true));
});

test("hasTouch: true when maxTouchPoints > 0", () => {
  withEnv({ maxTouchPoints: 5 }, () => assert.equal(hasTouch(), true));
});

test("touchPrimary: TRUE on a phone (touch + primary pointer is coarse)", () => {
  withEnv({ ontouchstart: true, maxTouchPoints: 5, media: { "(pointer: coarse)": true } },
    () => assert.equal(touchPrimary(), true));
});

test("touchPrimary: FALSE on a touchscreen laptop (touch hardware but a fine primary pointer)", () => {
  // The bug this guards: a Windows 2-in-1 reports touch but is mouse-driven → no virtual stick.
  withEnv({ ontouchstart: true, maxTouchPoints: 10, media: { "(pointer: fine)": true } },
    () => assert.equal(touchPrimary(), false));
});

test("touchPrimary: FALSE on a plain desktop (no touch at all)", () => {
  withEnv({ media: { "(pointer: fine)": true } }, () => assert.equal(touchPrimary(), false));
});

test("touchPrimary: falls back to capability when matchMedia is unavailable", () => {
  withEnv({ ontouchstart: true, maxTouchPoints: 5, noMatchMedia: true },
    () => assert.equal(touchPrimary(), true));
});
