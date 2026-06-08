import { test } from "node:test";
import assert from "node:assert/strict";
import { elementColor } from "./theme.js";

// elementColor is the single source of truth for element → colour and is hit by every
// monster/element UI. Per the freeform-element locked decision, it MUST map ANY string
// (AI-assigned, arbitrary) to a real colour — never crash, never return undefined/grey.
const isRgb = (c) => Array.isArray(c) && c.length === 3 && c.every((n) => Number.isFinite(n) && n >= 0 && n <= 255);

test("elementColor: known element → a valid RGB triple, case/whitespace-insensitive", () => {
  const fire = elementColor("fire");
  assert.ok(isRgb(fire));
  assert.deepEqual(elementColor("Fire"), fire);
  assert.deepEqual(elementColor("  FIRE  "), fire);
});

test("elementColor: synonyms + dual-types fold to one colour", () => {
  assert.deepEqual(elementColor("grass"), elementColor("nature"));
  assert.deepEqual(elementColor("wind"), elementColor("air"));
  assert.deepEqual(elementColor("steel"), elementColor("metal"));
  assert.deepEqual(elementColor("lightning"), elementColor("light"));
  assert.deepEqual(elementColor("shadow"), elementColor("dark"));
  // dual-type "a/b": the part before "/" wins
  assert.deepEqual(elementColor("fire/water"), elementColor("fire"));
  assert.deepEqual(elementColor("Dark / Light"), elementColor("dark"));
});

test("elementColor: empty/nullish → the neutral colour (all equal)", () => {
  const neutral = elementColor("");
  assert.ok(isRgb(neutral));
  assert.deepEqual(elementColor(null), neutral);
  assert.deepEqual(elementColor(undefined), neutral);
  assert.deepEqual(elementColor("   "), neutral);
});

test("elementColor: unknown AI-freeform element → valid, deterministic, case-insensitive colour", () => {
  const a = elementColor("Plasmaweave");
  assert.ok(isRgb(a), "freeform element still yields a real colour (never undefined/crash)");
  assert.deepEqual(elementColor("plasmaweave"), a, "deterministic + case-insensitive");
  // distinct unknowns spread across the fallback accents (not all one colour)
  const names = ["aether", "gloom", "brine", "quartz", "venomous", "sonorous", "gravity", "frostbite"];
  const distinct = new Set(names.map((n) => elementColor(n).join(",")));
  assert.ok(distinct.size > 1, "freeform elements spread across more than one fallback accent");
});

test("elementColor: ALWAYS returns a valid RGB triple (never grey-crashes)", () => {
  for (const n of ["fire", "FIRE", "grass", "fire/ice", "", null, undefined, "  ", "Zzxq", "123", "🔥"]) {
    assert.ok(isRgb(elementColor(n)), `elementColor(${JSON.stringify(n)}) must be a valid RGB triple`);
  }
});
