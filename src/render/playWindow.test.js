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

// TQ-96 (Dominik's TQ-117 decision): maxAspect lets the window be a bit wider than square,
// capped at ~4:3 — applied identically across surfaces via this shared helper.
const A43 = 4 / 3;

test("playWindowRect: maxAspect 4:3 widens the LANDSCAPE window toward the long axis (smaller side gutters)", () => {
  const r = playWindowRect(1280, 720, { maxAspect: A43 });
  assert.equal(r.h, 720, "height stays the short side");
  assert.equal(r.w, 960, "width = 720 * 4/3 (capped at 4:3, well within 1280)");
  assert.equal(r.x, 160, "centered: (1280-960)/2");
  assert.equal(r.right, 1120);
  assert.equal(r.y, 0);
  assert.equal(r.size, 720, "size stays the SHORTER side (back-compat)");
});

test("playWindowRect: maxAspect never exceeds the canvas (letterboxes to gutters beyond)", () => {
  // 800 wide, 720 tall: 4:3 would want 960 but the canvas is only 800 → full width, aspect < 4:3.
  const r = playWindowRect(800, 720, { maxAspect: A43 });
  assert.equal(r.w, 800, "clamped to the canvas width");
  assert.equal(r.h, 720);
  assert.equal(r.x, 0, "no side gutters — window spans full width");
});

test("playWindowRect: maxAspect 4:3 heightens the PORTRAIT window (smaller top/bottom gutters)", () => {
  const r = playWindowRect(480, 800, { maxAspect: A43 });
  assert.equal(r.w, 480, "width stays the short side");
  assert.equal(r.h, 640, "height = 480 * 4/3");
  assert.equal(r.y, 80, "centered: (800-640)/2");
  assert.equal(r.bottom, 720);
  assert.equal(r.size, 480, "size stays the shorter side");
});

test("playWindowRect: maxAspect 1 is exact back-compat (square)", () => {
  const a = playWindowRect(1280, 720, { maxAspect: 1 });
  const b = playWindowRect(1280, 720); // default
  assert.equal(a.w, a.h, "square");
  assert.equal(a.size, 720);
  assert.equal(a.x, 280);
  assert.equal(b.size, 720, "default still square");
});

test("playWindowLayout + maxAspect: gutters fully TILE the canvas (no world bleed) in both orientations", () => {
  for (const [W, H] of [[1280, 720], [800, 720], [480, 800], [720, 720]]) {
    const L = playWindowLayout(W, H, { maxAspect: A43 });
    const s = L.square;
    // Horizontal: left gutter + window width + right gutter === W (nothing of the world peeks through).
    assert.equal(L.left.w + (s.right - s.x) + L.right.w, W, `${W}x${H}: horizontal bands tile the width`);
    // Vertical: top gutter + window height + bottom gutter === H.
    assert.equal(L.top.h + (s.bottom - s.y) + L.bottom.h, H, `${W}x${H}: vertical bands tile the height`);
    // The window never spills past the canvas.
    assert.ok(s.x >= 0 && s.y >= 0 && s.right <= W && s.bottom <= H, `${W}x${H}: window within canvas`);
    // Aspect capped at ~4:3 (long/short ≤ 4/3 + rounding slack).
    const long = Math.max(s.right - s.x, s.bottom - s.y), short = Math.min(s.right - s.x, s.bottom - s.y);
    assert.ok(long / short <= A43 + 0.01, `${W}x${H}: aspect ≤ 4:3`);
  }
});
