import { test } from "node:test";
import assert from "node:assert";
import { playWindowRect, drawPlayWindow, playWindowLayout } from "./playWindow.js";

test("playWindowRect: centered square of side min(W,H) in landscape", () => {
  const r = playWindowRect(1280, 720);
  assert.equal(r.size, 720, "side = the smaller (height) dimension");
  assert.equal(r.x, 280, "centered horizontally: (1280-720)/2");
  assert.equal(r.y, 0, "flush vertically (square == height)");
  assert.equal(r.right, 1000);
  assert.equal(r.bottom, 720);
});

test("playWindowRect: portrait puts the extra room top/bottom", () => {
  const r = playWindowRect(480, 800);
  assert.equal(r.size, 480, "side = the smaller (width) dimension");
  assert.equal(r.x, 0, "flush horizontally (square == width)");
  assert.equal(r.y, 160, "centered vertically: (800-480)/2");
});

test("playWindowRect: margin insets the square from the smaller edge", () => {
  const r = playWindowRect(1000, 600, { margin: 20 });
  assert.equal(r.size, 560, "600 - 2*20");
});

test("playWindowRect: memoizes the margin=0 path and returns a frozen, reusable rect", () => {
  const a = playWindowRect(1280, 720);
  const b = playWindowRect(1280, 720);
  assert.equal(a, b, "same (W,H) returns the cached object (no re-alloc per call)");
  assert.ok(Object.isFrozen(a), "cached rect is frozen (read-only contract; no cross-caller corruption)");
  const c = playWindowRect(800, 800);
  assert.notEqual(c, a, "a different viewport recomputes");
  assert.equal(c.size, 800);
  // The memo must not leak into the margin path: a non-zero margin is always fresh + correct.
  const m = playWindowRect(1280, 720, { margin: 20 });
  assert.equal(m.size, 680, "720 - 2*20");
  assert.notEqual(m, a, "margin result is not the cached margin=0 rect");
  // And the cache still serves the margin=0 rect afterwards.
  assert.equal(playWindowRect(1280, 720).size, 720);
});

// The peripheral bands are now FULLY OPAQUE bezel (color [10,11,16], opacity 1) so the
// world is hidden outside the square — no translucent dim, no world bleed.
const isBezel = (o) => o.color.r === 10 && o.color.g === 11 && o.color.b === 16;

test("drawPlayWindow: landscape occludes left/right gutters opaquely, not top/bottom", () => {
  const calls = [];
  const k = {
    width: () => 1280, height: () => 720,
    vec2: (x, y) => ({ x, y }), rgb: (r, g, b) => ({ r, g, b }),
    drawRect: (o) => calls.push(o),
  };
  drawPlayWindow(k);
  const bands = calls.filter(isBezel);
  assert.equal(bands.length, 2, "two side gutters in landscape (top/bottom have zero height)");
  assert.ok(bands.every((o) => o.width === 280 && o.height === 720), "gutters fill the side margins");
  assert.ok(bands.every((o) => o.opacity === 1), "gutters are fully opaque (no world bleed)");
});

test("drawPlayWindow: square aspect draws no gutters (no-op periphery)", () => {
  const calls = [];
  const k = {
    width: () => 600, height: () => 600,
    vec2: (x, y) => ({ x, y }), rgb: (r, g, b) => ({ r, g, b }),
    drawRect: (o) => calls.push(o),
  };
  drawPlayWindow(k);
  assert.equal(calls.filter(isBezel).length, 0, "square viewport = no peripheral gutters");
});

test("drawPlayWindow: portrait occludes top/bottom gutters opaquely, not left/right", () => {
  const calls = [];
  const k = {
    width: () => 480, height: () => 800,
    vec2: (x, y) => ({ x, y }), rgb: (r, g, b) => ({ r, g, b }),
    drawRect: (o) => calls.push(o),
  };
  drawPlayWindow(k); // square = 480, y = 160, bottom = 640
  const bands = calls.filter(isBezel);
  assert.equal(bands.length, 2, "two top/bottom gutters in portrait (sides have zero width)");
  assert.ok(bands.every((o) => o.width === 480 && o.height === 160), "gutters fill the top/bottom margins");
  assert.ok(bands.every((o) => o.opacity === 1), "gutters are fully opaque (no world bleed)");
});

test("playWindowLayout: landscape exposes left/right gutters; top/bottom are empty", () => {
  const L = playWindowLayout(1280, 720);
  assert.equal(L.square.size, 720);
  assert.ok(L.landscape, "side gutters present");
  assert.ok(!L.portrait, "no top/bottom gutters in landscape");
  assert.deepEqual({ x: L.left.x, y: L.left.y, w: L.left.w, h: L.left.h }, { x: 0, y: 0, w: 280, h: 720 });
  assert.deepEqual({ x: L.right.x, y: L.right.y, w: L.right.w, h: L.right.h }, { x: 1000, y: 0, w: 280, h: 720 });
  assert.equal(L.top.h, 0, "top gutter has zero height in landscape");
  assert.equal(L.bottom.h, 0, "bottom gutter has zero height in landscape");
});

test("playWindowLayout: portrait exposes top/bottom gutters; left/right are empty", () => {
  const L = playWindowLayout(480, 800);
  assert.ok(L.portrait, "top/bottom gutters present");
  assert.ok(!L.landscape, "no side gutters in portrait");
  assert.deepEqual({ x: L.top.x, y: L.top.y, w: L.top.w, h: L.top.h }, { x: 0, y: 0, w: 480, h: 160 });
  assert.deepEqual({ x: L.bottom.x, y: L.bottom.y, w: L.bottom.w, h: L.bottom.h }, { x: 0, y: 640, w: 480, h: 160 });
  assert.equal(L.left.w, 0, "left gutter has zero width in portrait");
  assert.equal(L.right.w, 0, "right gutter has zero width in portrait");
});
