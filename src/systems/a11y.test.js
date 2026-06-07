import test from "node:test";
import assert from "node:assert/strict";
import { prefersReducedMotion, reduceMotionSetting } from "./a11y.js";

test("prefersReducedMotion: false in a non-browser context (no window)", () => {
  assert.equal(prefersReducedMotion(), false);
});

test("prefersReducedMotion: true when the reduce-motion query matches", () => {
  global.window = { matchMedia: (q) => ({ matches: q === "(prefers-reduced-motion: reduce)" }) };
  try {
    assert.equal(prefersReducedMotion(), true);
  } finally {
    delete global.window;
  }
});

test("prefersReducedMotion: false when the user has no motion preference", () => {
  global.window = { matchMedia: () => ({ matches: false }) };
  try {
    assert.equal(prefersReducedMotion(), false);
  } finally {
    delete global.window;
  }
});

test("prefersReducedMotion: false (no throw) when matchMedia is unavailable", () => {
  global.window = {}; // window exists but matchMedia doesn't (older browsers)
  try {
    assert.equal(prefersReducedMotion(), false);
  } finally {
    delete global.window;
  }
});

test("reduceMotionSetting: defaults to 'auto' with no storage", () => {
  assert.equal(reduceMotionSetting(), "auto");
});

test("prefersReducedMotion: in-game 'on' forces true even if the OS says no", () => {
  global.localStorage = { getItem: () => "on", setItem: () => {} };
  global.window = { matchMedia: () => ({ matches: false }) };
  try {
    assert.equal(prefersReducedMotion(), true);
  } finally {
    delete global.localStorage;
    delete global.window;
  }
});

test("prefersReducedMotion: in-game 'off' forces false even if the OS says yes", () => {
  global.localStorage = { getItem: () => "off", setItem: () => {} };
  global.window = { matchMedia: () => ({ matches: true }) };
  try {
    assert.equal(prefersReducedMotion(), false);
  } finally {
    delete global.localStorage;
    delete global.window;
  }
});
