import test from "node:test";
import assert from "node:assert/strict";
import { cleanAttackName, getAttacksForMonster } from "./gamedata.js";

// An owned monster whose (AI-generated) type an admin later deleted resolves to an
// undefined monsterType. getAttacksForMonster must return [] — not throw on
// `.attack_1` — so combat resolution degrades to "no usable move" instead of
// crashing the round server-side.
test("getAttacksForMonster returns [] for a missing/undefined type (no throw)", () => {
  assert.deepEqual(getAttacksForMonster(undefined), []);
  assert.deepEqual(getAttacksForMonster(null), []);
});

// CN-7: attack names that embed their description are stripped for display/prompts.
test("cleanAttackName strips an embedded ' - description' suffix", () => {
  assert.equal(
    cleanAttackName("Burrow Strike - Digs underground and attacks from below."),
    "Burrow Strike",
  );
  assert.equal(
    cleanAttackName("Healing Light - Restores health to a single ally."),
    "Healing Light",
  );
});

test("cleanAttackName leaves clean names unchanged", () => {
  assert.equal(cleanAttackName("Healing Light"), "Healing Light");
  assert.equal(cleanAttackName("Strike"), "Strike");
});

test("cleanAttackName is safe on hyphenated names and nullish input", () => {
  assert.equal(cleanAttackName("Hit-and-Run"), "Hit-and-Run"); // no space-hyphen-space → unchanged
  assert.equal(cleanAttackName(""), "");
  assert.equal(cleanAttackName(null), "");
  assert.equal(cleanAttackName(undefined), "");
});
