import test from "node:test";
import assert from "node:assert/strict";
import { prefersReducedMotion } from "./a11y.js";

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
