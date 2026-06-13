import test from "node:test";
import assert from "node:assert/strict";
import { drawCurrencyIcon } from "./currencyIcon.js";

// Immediate-mode render — smoke-test with a mock k that counts draw calls per primitive.
function mockK() {
  const calls = { circle: 0, ellipse: 0, line: 0 };
  return {
    calls,
    k: {
      vec2: (x, y) => ({ x, y }),
      rgb: (r, g, b) => ({ r, g, b }),
      drawCircle: () => { calls.circle++; },
      drawEllipse: () => { calls.ellipse++; },
      drawLine: () => { calls.line++; },
    },
  };
}

test("gold draws a round coin (disc + rim + shine), no gem facets", () => {
  const { k, calls } = mockK();
  assert.doesNotThrow(() => drawCurrencyIcon(k, "gold", { x: 10, y: 10, r: 6, color: [212, 160, 23] }));
  assert.ok(calls.circle >= 3, "coin disc + rim + shine");
  assert.equal(calls.ellipse + calls.line, 0, "gold uses no gem facets");
});

test("essence draws a faceted gem (body + crown/table facets), not a disc", () => {
  const { k, calls } = mockK();
  assert.doesNotThrow(() => drawCurrencyIcon(k, "essence", { x: 10, y: 10, r: 6, color: [150, 90, 220] }));
  assert.ok(calls.ellipse >= 1, "gem body");
  assert.ok(calls.line >= 2, "crown/facet lines");
  assert.equal(calls.circle, 0, "essence is not a disc");
});

test("gold and essence have distinct silhouettes (legibly different currencies)", () => {
  const g = mockK(); drawCurrencyIcon(g.k, "gold", { x: 0, y: 0, r: 5, color: [1, 2, 3] });
  const e = mockK(); drawCurrencyIcon(e.k, "essence", { x: 0, y: 0, r: 5, color: [1, 2, 3] });
  assert.ok(g.calls.line === 0 && e.calls.line > 0, "only essence is faceted");
  assert.ok(g.calls.circle > 0 && e.calls.circle === 0, "only gold is a disc");
});

test("unknown kind falls back to a plain dot; missing opts are safe", () => {
  const { k, calls } = mockK();
  assert.doesNotThrow(() => drawCurrencyIcon(k, "doubloons", { x: 0, y: 0, r: 4, color: [1, 2, 3] }));
  assert.equal(calls.circle, 1, "one plain tinted dot");
  assert.equal(calls.ellipse + calls.line, 0, "no facets for an unknown kind");
  assert.doesNotThrow(() => drawCurrencyIcon(k, "gold"), "no opts → safe defaults");
});
