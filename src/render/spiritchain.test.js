import { test } from "node:test";
import assert from "node:assert/strict";
import { drawCaptureAnimation, drawCaptureFail, drawChainBreak, chainColor } from "./spiritchain.js";

// Minimal Kaboom stub recording the primitive draws, so we can assert the
// success-vs-fail capture distinction without a browser (mirrors portal.test.js).
function mockK() {
  const calls = [];
  return {
    calls,
    vec2: (x, y) => ({ x, y }),
    rgb: (r, g, b) => [r, g, b],
    drawCircle: (o) => calls.push({ kind: "circle", ...o }),
    drawLine: (o) => calls.push({ kind: "line", ...o }),
  };
}
const isWhite = (c) => Array.isArray(c) && c[0] === 255 && c[1] === 255 && c[2] === 255;
// Furthest point any draw reaches from the (x,y) origin — measures expansion.
function maxReach(calls, x, y) {
  let m = 0;
  for (const c of calls) {
    for (const v of [c.pos, c.p1, c.p2]) {
      if (v) m = Math.max(m, Math.hypot(v.x - x, v.y - y));
    }
  }
  return m;
}

test("chainColor: tint with neutral fallback", () => {
  assert.deepEqual(chainColor({ color: [10, 20, 30] }), [10, 20, 30]);
  assert.deepEqual(chainColor(null), [180, 180, 190]);
  assert.deepEqual(chainColor({}), [180, 180, 190]);
});

test("drawCaptureAnimation (success): bright white core, never throws", () => {
  for (const p of [0, 0.3, 0.7, 1]) {
    const k = mockK();
    assert.doesNotThrow(() => drawCaptureAnimation(k, { x: 50, y: 60, color: [80, 200, 180], progress: p }));
    assert.ok(k.calls.length > 0, `progress ${p} should draw`);
  }
  // A successful catch swells a bright white core — its signature look.
  const k = mockK();
  drawCaptureAnimation(k, { x: 50, y: 60, color: [80, 200, 180], progress: 0.8 });
  assert.ok(k.calls.some((c) => c.kind === "circle" && isWhite(c.color)), "success draws a white core");
});

test("drawCaptureFail (break-free): no white core, expands outward, never throws", () => {
  for (const p of [0, 0.3, 0.7, 1]) {
    const k = mockK();
    assert.doesNotThrow(() => drawCaptureFail(k, { x: 50, y: 60, color: [80, 200, 180], progress: p }));
    assert.ok(k.calls.length > 0, `progress ${p} should draw`);
  }
  // No celebratory white core — that's how it reads as a *failure*, not a catch.
  const mid = mockK();
  drawCaptureFail(mid, { x: 50, y: 60, color: [80, 200, 180], progress: 0.6 });
  assert.ok(!mid.calls.some((c) => isWhite(c.color)), "fail must not draw a white catch-core");

  // The chain snaps OUTWARD: later in the animation it reaches further than early.
  const early = mockK(); drawCaptureFail(early, { x: 0, y: 0, color: [80, 200, 180], progress: 0.1 });
  const late = mockK(); drawCaptureFail(late, { x: 0, y: 0, color: [80, 200, 180], progress: 0.9 });
  assert.ok(maxReach(late.calls, 0, 0) > maxReach(early.calls, 0, 0), "fail FX flies outward over time");
});

// Lowest (max-y) point any draw reaches — measures the gravity fall.
function maxY(calls) {
  let m = -Infinity;
  for (const c of calls) for (const v of [c.pos, c.p1, c.p2]) if (v) m = Math.max(m, v.y);
  return m;
}

test("drawChainBreak (depletion): fragments fall under gravity, never throws", () => {
  for (const p of [0, 0.3, 0.7, 1]) {
    const k = mockK();
    assert.doesNotThrow(() => drawChainBreak(k, { x: 50, y: 60, color: [80, 200, 180], progress: p }));
    assert.ok(k.calls.length > 0, `progress ${p} should draw`);
  }
  // Fragments accelerate DOWNWARD: late in the break they sit well below where
  // they started, which is what distinguishes it from the radial break-free FX.
  const early = mockK(); drawChainBreak(early, { x: 0, y: 0, color: [80, 200, 180], progress: 0.2 });
  const late = mockK(); drawChainBreak(late, { x: 0, y: 0, color: [80, 200, 180], progress: 0.9 });
  assert.ok(maxY(late.calls) > maxY(early.calls) + 10, "broken links fall downward over time");
});
