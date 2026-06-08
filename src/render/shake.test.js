import { test } from "node:test";
import assert from "node:assert";
import { addShake, updateShake, shakeOffset, shakeTrauma, clearShake, SHAKE_MAX, setShakeEnabled, shakeEnabled, toggleShake } from "./shake.js";

test("shake: at rest the offset is exactly zero", () => {
  clearShake();
  assert.equal(shakeTrauma(), 0);
  assert.deepEqual(shakeOffset(), { x: 0, y: 0 });
});

test("shake: addShake raises trauma and caps at 1", () => {
  clearShake();
  addShake(0.4);
  assert.ok(Math.abs(shakeTrauma() - 0.4) < 1e-9);
  addShake(1); // would exceed 1 → capped
  assert.equal(shakeTrauma(), 1);
});

test("shake: offset magnitude is bounded by trauma²·MAX", () => {
  clearShake();
  addShake(0.5); // trauma 0.5 → max offset 0.25·MAX
  const bound = 0.25 * SHAKE_MAX + 1e-6;
  for (let i = 0; i < 50; i++) {
    const o = shakeOffset();
    assert.ok(Math.abs(o.x) <= bound && Math.abs(o.y) <= bound, "offset within trauma² envelope");
  }
});

test("shake: updateShake decays trauma to zero over time", () => {
  clearShake();
  addShake(1);
  for (let i = 0; i < 120; i++) updateShake(1 / 60); // ~2s of frames
  assert.equal(shakeTrauma(), 0);
  assert.deepEqual(shakeOffset(), { x: 0, y: 0 });
});

test("shake: negative/zero amounts don't reduce trauma", () => {
  clearShake();
  addShake(0.6);
  addShake(-5);
  assert.ok(Math.abs(shakeTrauma() - 0.6) < 1e-9);
});

test("shake: disabling it makes addShake a no-op and clears trauma", () => {
  clearShake();
  setShakeEnabled(false);
  try {
    assert.equal(shakeEnabled(), false);
    addShake(1);
    assert.equal(shakeTrauma(), 0, "no trauma builds when disabled");
    assert.deepEqual(shakeOffset(), { x: 0, y: 0 });
    assert.equal(toggleShake(), true, "toggle flips back on");
    addShake(0.5);
    assert.ok(shakeTrauma() > 0, "shake works again once re-enabled");
  } finally {
    setShakeEnabled(true);
    clearShake();
  }
});
