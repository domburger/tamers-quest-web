import { test } from "node:test";
import assert from "node:assert";
import { emit, updateFx, drawFx, clearFx, fxCount } from "./fx.js";

test("emit adds particles and caps at the budget", () => {
  clearFx();
  emit({ x: 0, y: 0, n: 10 });
  assert.equal(fxCount(), 10);
  emit({ x: 0, y: 0, n: 5000 }); // far exceeds the cap
  assert.ok(fxCount() <= 220 && fxCount() >= 220 - 0, "stays within MAX budget");
});

test("updateFx ages particles and reaps the dead", () => {
  clearFx();
  emit({ x: 0, y: 0, n: 5, life: 0.1, speed: 0 });
  updateFx(0.05);
  assert.equal(fxCount(), 5, "still alive at half-life");
  updateFx(0.1);
  assert.equal(fxCount(), 0, "reaped past life");
});

test("drawFx draws one circle per live particle", () => {
  clearFx();
  emit({ x: 5, y: 5, n: 3, life: 1 });
  let calls = 0;
  const k = { drawCircle: () => { calls++; }, vec2: (x, y) => ({ x, y }), rgb: (r, g, b) => [r, g, b] };
  drawFx(k);
  assert.equal(calls, 3);
});

test("clearFx empties the pool; updateFx/drawFx are safe when empty", () => {
  clearFx();
  assert.equal(fxCount(), 0);
  updateFx(0.016); // no throw on empty
  const k = { drawCircle: () => {}, vec2: () => ({}), rgb: () => [] };
  drawFx(k); // no throw on empty
  assert.ok(true);
});
