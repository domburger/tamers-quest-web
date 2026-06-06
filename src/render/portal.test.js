import { test } from "node:test";
import assert from "node:assert/strict";
import { drawPortal } from "./portal.js";

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
