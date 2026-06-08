import { test } from "node:test";
import assert from "node:assert/strict";
import {
  drawCaptureAnimation, drawCaptureFail, drawChainBreak, drawChainImpact,
  drawChest, drawSpiritChainModel, drawSpiritChainProjectile, chainColor,
} from "./spiritchain.js";

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
    drawEllipse: (o) => calls.push({ kind: "ellipse", ...o }),
    drawRect: (o) => calls.push({ kind: "rect", ...o }),
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

test("chainColor: uses the def tint, else a valid fallback triple", () => {
  assert.deepEqual(chainColor({ color: [10, 20, 30] }), [10, 20, 30]);
  // Don't pin the exact fallback (it's a tunable PAL token) — just require a sane RGB.
  for (const fb of [chainColor(null), chainColor({})]) {
    assert.ok(Array.isArray(fb) && fb.length === 3, "fallback is an RGB triple");
    assert.ok(fb.every((c) => Number.isFinite(c) && c >= 0 && c <= 255), "fallback channels valid");
  }
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

test("drawChainImpact: draws just the shockwave ring (sparks migrated to fx pool)", () => {
  const k = mockK();
  drawChainImpact(k, { x: 0, y: 0, color: [80, 200, 180], progress: 0.5 });
  assert.ok(k.calls.some((c) => c.kind === "circle"), "draws the ring");
  assert.ok(!k.calls.some((c) => c.kind === "line"), "no manual spark lines (now via fx)");
  for (const p of [0, 0.5, 1]) assert.doesNotThrow(() => drawChainImpact(mockK(), { x: 1, y: 2, color: [10, 20, 30], progress: p }));
});

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

test("drawChest: renders a chest across the pulse cycle (never throws)", () => {
  for (const t of [0, 0.5, 1.7, 99]) {
    const k = mockK();
    assert.doesNotThrow(() => drawChest(k, { x: 40, y: 50, t }));
    assert.ok(k.calls.length > 0, `t=${t} draws something`);
  }
});

test("drawSpiritChainModel: draws the spinning link ring + glow (never throws)", () => {
  for (const t of [0, 1, 5]) {
    const k = mockK();
    assert.doesNotThrow(() => drawSpiritChainModel(k, { x: 10, y: 20, color: [70, 230, 198], t }));
    assert.ok(k.calls.some((c) => c.kind === "circle"), `t=${t} draws the ring`);
  }
  assert.doesNotThrow(() => drawSpiritChainModel(mockK(), { x: 0, y: 0, color: [1, 2, 3], t: 0, scale: 0.5 }));
});

test("drawSpiritChainProjectile: draws the in-flight chain + trail; zero velocity yields no NaN", () => {
  const moving = mockK();
  assert.doesNotThrow(() => drawSpiritChainProjectile(moving, { x: 5, y: 5, vx: 30, vy: -10 }, [70, 230, 198], 1));
  assert.ok(moving.calls.length > 3, "comet trail + head");
  // A stationary projectile: the `hypot||1` guard must prevent a divide-by-zero → NaN coords.
  const still = mockK();
  assert.doesNotThrow(() => drawSpiritChainProjectile(still, { x: 0, y: 0, vx: 0, vy: 0 }, [70, 230, 198], 0));
  const finite = still.calls.every((c) => [c.pos, c.p1, c.p2].every((v) => !v || (Number.isFinite(v.x) && Number.isFinite(v.y))));
  assert.ok(finite, "no NaN coordinates at zero velocity");
});
