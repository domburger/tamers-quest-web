import { test } from "node:test";
import assert from "node:assert";
import { playWindowRect, drawPlayWindow } from "./playWindow.js";

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

test("drawPlayWindow: landscape dims left/right bands, not top/bottom", () => {
  const calls = [];
  const k = {
    width: () => 1280, height: () => 720,
    vec2: (x, y) => ({ x, y }), rgb: (r, g, b) => ({ r, g, b }),
    drawRect: (o) => calls.push(o),
  };
  drawPlayWindow(k, { frame: false });
  const dimRects = calls.filter((o) => o.color.r === 8 && o.color.g === 8 && o.color.b === 12);
  assert.equal(dimRects.length, 2, "two side bands in landscape (top/bottom have zero height)");
  assert.ok(dimRects.every((o) => o.width === 280 && o.height === 720), "bands fill the side margins");
});

test("drawPlayWindow: square aspect draws no dim bands (no-op periphery)", () => {
  const calls = [];
  const k = {
    width: () => 600, height: () => 600,
    vec2: (x, y) => ({ x, y }), rgb: (r, g, b) => ({ r, g, b }),
    drawRect: (o) => calls.push(o),
  };
  drawPlayWindow(k, { frame: false });
  const dimRects = calls.filter((o) => o.color.r === 8);
  assert.equal(dimRects.length, 0, "square viewport = no peripheral bands");
});
