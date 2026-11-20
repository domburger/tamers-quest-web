import { test } from "node:test";
import assert from "node:assert/strict";
import { drawChest, drawSpiritChainModel, drawSpiritChainProjectile, chainColor } from "./spiritchain.js";

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
test("chainColor: uses the def tint, else a valid fallback triple", () => {
  assert.deepEqual(chainColor({ color: [10, 20, 30] }), [10, 20, 30]);
  // Don't pin the exact fallback (it's a tunable PAL token) — just require a sane RGB.
  for (const fb of [chainColor(null), chainColor({})]) {
    assert.ok(Array.isArray(fb) && fb.length === 3, "fallback is an RGB triple");
    assert.ok(fb.every((c) => Number.isFinite(c) && c >= 0 && c <= 255), "fallback channels valid");
  }
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
