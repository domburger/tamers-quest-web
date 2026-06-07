import test from "node:test";
import assert from "node:assert/strict";
import { cleanAttackName } from "./gamedata.js";

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
