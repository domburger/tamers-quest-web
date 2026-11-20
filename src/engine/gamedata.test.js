import test from "node:test";
import assert from "node:assert/strict";
import { cleanAttackName, getAttacksForMonster, addEvolvedType, getMonsterType, getMonsterTypes, getEvolvedTypes, setEvolvedTypes, setGameData } from "./gamedata.js";

test("getAttacksForMonster returns [] for a missing/undefined type (no throw)", () => {
  assert.deepEqual(getAttacksForMonster(undefined), []);
  assert.deepEqual(getAttacksForMonster(null), []);
});

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
  assert.equal(cleanAttackName("Hit-and-Run"), "Hit-and-Run");
  assert.equal(cleanAttackName(""), "");
  assert.equal(cleanAttackName(null), "");
  assert.equal(cleanAttackName(undefined), "");
});

test("TQ-551 evolved types: resolvable by getMonsterType, excluded from getMonsterTypes (no wild spawns/bestiary)", () => {
  setGameData({ monsterTypes: [{ typeName: "Base", baseHealth: 40 }] });
  setEvolvedTypes([]);
  assert.equal(getMonsterType("Base").baseHealth, 40, "spawnable type resolves");
  assert.equal(getMonsterType("Base#evo30#x"), undefined, "evolved type not registered yet");
  addEvolvedType({ typeName: "Base#evo30#x", baseTypeName: "Base", evolved: true, baseHealth: 80 });
  assert.equal(getMonsterType("Base#evo30#x").baseHealth, 80, "evolved type resolves by getMonsterType");
  assert.equal(getMonsterTypes().some((m) => m.typeName === "Base#evo30#x"), false, "evolved type is NOT in the spawnable pool");
  assert.deepEqual(getEvolvedTypes().map((m) => m.typeName), ["Base#evo30#x"], "exposed for persistence");
  setEvolvedTypes([{ typeName: "Other#evo30#y", evolved: true }]);
  assert.equal(getMonsterType("Base#evo30#x"), undefined, "old evolved types cleared on reload");
  assert.ok(getMonsterType("Other#evo30#y"), "reloaded evolved type resolves");
  setEvolvedTypes([]);
});
