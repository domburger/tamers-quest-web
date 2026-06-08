import { test } from "node:test";
import assert from "node:assert/strict";
import { drawPortal, drawExtractFlash } from "./portal.js";

// A minimal Kaboom stub that records the primitive draw calls drawPortal makes,
// so we can assert the rise-from-the-ground animation without a browser.
function mockK() {
  const calls = [];
  return {
    calls,
    vec2: (x, y) => ({ x, y }),
    rgb: (r, g, b) => [r, g, b],
    drawEllipse: (o) => calls.push({ kind: "ellipse", ...o }),
    drawCircle: (o) => calls.push({ kind: "circle", ...o }),
  };
}
const maxEllipseRY = (calls) => Math.max(0, ...calls.filter((c) => c.kind === "ellipse").map((c) => c.radiusY));

test("drawPortal: barely emerged at spawn, fully grown once risen", () => {
  const young = mockK();
  drawPortal(young, { x: 100, y: 100, t: 0, age: 0 });
  const old = mockK();
  drawPortal(old, { x: 100, y: 100, t: 0, age: 2 }); // > RISE_S → fully risen

  // At spawn it only tears the ground (small); risen, the rift body + beam are tall.
  assert.ok(maxEllipseRY(young.calls) < 12, `spawn portal should be flat, got ${maxEllipseRY(young.calls)}`);
  assert.ok(maxEllipseRY(old.calls) > 40, `risen portal should be tall, got ${maxEllipseRY(old.calls)}`);
  // The risen portal is visibly richer (more layers + orbiting motes).
  assert.ok(old.calls.length > young.calls.length, "risen portal draws more than the emerging one");
  // Rift height grows monotonically through the rise.
  const at = (age) => { const k = mockK(); drawPortal(k, { x: 0, y: 0, t: 0, age }); return maxEllipseRY(k.calls); };
  assert.ok(at(0.3) < at(0.6) && at(0.6) < at(1.2), "portal height rises over time");
});

test("drawPortal: never throws and always draws something for a live portal", () => {
  for (const age of [0, 0.1, 0.5, 1.2, 5, 999]) {
    const k = mockK();
    assert.doesNotThrow(() => drawPortal(k, { x: 10, y: 20, t: 1.5, age }));
    assert.ok(k.calls.length > 0, `age ${age} should draw`);
  }
});

// drawExtractFlash needs width/height/drawRect (not in the shared mock above) — use a
// local stub. It's the extraction-climax white-out, drawn over both SP & MP on a win.
function mkFlash() {
  const calls = [];
  return { calls, width: () => 1280, height: () => 720, vec2: (x, y) => ({ x, y }), rgb: (r, g, b) => [r, g, b],
    drawCircle: (o) => calls.push({ kind: "circle", ...o }), drawRect: (o) => calls.push({ kind: "rect", ...o }) };
}

test("drawExtractFlash: expands + white-out across the transition; clamps p; no NaN; never throws", () => {
  for (const p of [0, 0.5, 1, -0.5, 2]) { // includes out-of-range → must clamp
    const k = mkFlash();
    assert.doesNotThrow(() => drawExtractFlash(k, { x: 640, y: 360, p }));
    assert.ok(k.calls.length > 0, `p=${p} draws something`);
    for (const c of k.calls) {
      if (c.radius !== undefined) assert.ok(Number.isFinite(c.radius) && c.radius >= 0, `finite, non-negative radius at p=${p}`);
      if (c.opacity !== undefined) assert.ok(c.opacity >= 0, `non-negative opacity at p=${p}`);
    }
  }
  // The shockwave ring grows as the transition progresses.
  const maxR = (calls) => Math.max(...calls.filter((c) => c.kind === "circle").map((c) => c.radius));
  const early = mkFlash(); drawExtractFlash(early, { x: 0, y: 0, p: 0.1 });
  const late = mkFlash(); drawExtractFlash(late, { x: 0, y: 0, p: 0.9 });
  assert.ok(maxR(late.calls) > maxR(early.calls), "the flash expands over the transition");
});
