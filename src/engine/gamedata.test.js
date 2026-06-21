import test from "node:test";
import assert from "node:assert/strict";
import { cleanAttackName, getAttacksForMonster, addEvolvedType, getMonsterType, getMonsterTypes, getEvolvedTypes, setEvolvedTypes, setGameData } from "./gamedata.js";

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

// TQ-551: the evolved-type registry resolves via getMonsterType but stays OUT of the spawnable pool.
test("TQ-551 evolved types: resolvable by getMonsterType, excluded from getMonsterTypes (no wild spawns/bestiary)", () => {
  setGameData({ monsterTypes: [{ typeName: "Base", baseHealth: 40 }] });
  setEvolvedTypes([]); // clean slate
  assert.equal(getMonsterType("Base").baseHealth, 40, "spawnable type resolves");
  assert.equal(getMonsterType("Base#evo30#x"), undefined, "evolved type not registered yet");
  addEvolvedType({ typeName: "Base#evo30#x", baseTypeName: "Base", evolved: true, baseHealth: 80 });
  assert.equal(getMonsterType("Base#evo30#x").baseHealth, 80, "evolved type resolves by getMonsterType");
  assert.equal(getMonsterTypes().some((m) => m.typeName === "Base#evo30#x"), false, "evolved type is NOT in the spawnable pool");
  assert.deepEqual(getEvolvedTypes().map((m) => m.typeName), ["Base#evo30#x"], "exposed for persistence");
  // boot-load replaces the set
  setEvolvedTypes([{ typeName: "Other#evo30#y", evolved: true }]);
  assert.equal(getMonsterType("Base#evo30#x"), undefined, "old evolved types cleared on reload");
  assert.ok(getMonsterType("Other#evo30#y"), "reloaded evolved type resolves");
  setEvolvedTypes([]); // don't leak into other tests
});
