import { test } from "node:test";
import assert from "node:assert";
import { emit, emitText, updateFx, drawFx, drawFxScreen, clearFx, fxCount, setFxBudget, fxBudget } from "./fx.js";

test("emit adds particles and caps at the budget", () => {
  clearFx();
  emit({ x: 0, y: 0, n: 10 });
  assert.equal(fxCount(), 10);
  emit({ x: 0, y: 0, n: 5000 }); // far exceeds the cap
  assert.ok(fxCount() <= 220 && fxCount() >= 220 - 0, "stays within MAX budget");
});

test("MOB-T3: setFxBudget lowers the particle ceiling (mobile perf mode)", () => {
  const orig = fxBudget();
  try {
    setFxBudget(30);
    clearFx();
    emit({ x: 0, y: 0, n: 500 });
    assert.equal(fxCount(), 30, "emit respects the lowered budget");
    setFxBudget(0);
    clearFx();
    emit({ x: 0, y: 0, n: 10 });
    assert.equal(fxCount(), 0, "a zero budget drops all FX");
  } finally {
    setFxBudget(orig); // restore so other tests see the default cap
    clearFx();
  }
});

test("updateFx ages particles and reaps the dead", () => {
  clearFx();
  emit({ x: 0, y: 0, n: 5, life: 0.1, speed: 0 });
  updateFx(0.05);
  assert.equal(fxCount(), 5, "still alive at half-life");
  updateFx(0.1);
  assert.equal(fxCount(), 0, "reaped past life");
});

test("drawFx draws a bloom halo + a core circle per live particle", () => {
  clearFx();
  emit({ x: 5, y: 5, n: 3, life: 1 });
  let calls = 0;
  const k = { drawCircle: () => { calls++; }, vec2: (x, y) => ({ x, y }), rgb: (r, g, b) => [r, g, b] };
  drawFx(k);
  assert.equal(calls, 6, "two circles (halo + core) per particle");
});

test("fixed particles draw via drawFxScreen; world particles via drawFx", () => {
  clearFx();
  emit({ x: 0, y: 0, n: 2, life: 1 }); // world-space
  emit({ x: 0, y: 0, n: 3, life: 1, fixed: true }); // screen-space
  let world = 0, screen = 0;
  const kW = { drawCircle: () => { world++; }, vec2: () => ({}), rgb: () => [] };
  const kS = { drawCircle: () => { screen++; }, vec2: () => ({}), rgb: () => [] };
  drawFx(kW); drawFxScreen(kS);
  assert.equal(world, 4, "drawFx draws only world particles (halo + core each)");
  assert.equal(screen, 6, "drawFxScreen draws only fixed particles (halo + core each)");
});

test("emitText spawns a labelled particle drawn as text, not a circle", () => {
  clearFx();
  emitText({ x: 10, y: 20, text: "Chest opened!", life: 1 });
  assert.equal(fxCount(), 1, "one label particle");
  let texts = 0, circles = 0;
  const k = {
    drawText: () => { texts++; }, drawCircle: () => { circles++; },
    vec2: (x, y) => ({ x, y }), rgb: (...c) => c,
  };
  drawFx(k);
  assert.equal(circles, 0, "labels are not drawn as circles");
  assert.equal(texts, 2, "label draws a dark backer + the coloured text");
});

test("clearFx empties the pool; updateFx/drawFx are safe when empty", () => {
  clearFx();
  assert.equal(fxCount(), 0);
  updateFx(0.016); // no throw on empty
  const k = { drawCircle: () => {}, vec2: () => ({}), rgb: () => [] };
  drawFx(k); // no throw on empty
  assert.ok(true);
});
