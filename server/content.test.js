import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes, addMonsterType, removeMonsterType, getAttacksForMonster } from "../src/engine/gamedata.js";
import { generateMonster } from "./content.js";

function loadData() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"), attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"), items: read("item.json"),
  });
}

test("monster pool has a low-rarity floor with usable attacks (GP-1/CN-2)", () => {
  loadData();
  const pool = getMonsterTypes();
  const byR = (r) => pool.filter((m) => m.rarity === r);
  // The rarity wall fix: early spawns need real R1/R2 variety (pool had 0×R1, 1×R2).
  assert.ok(byR(1).length >= 5, `expected ≥5 R1 monsters, got ${byR(1).length}`);
  assert.ok(byR(2).length >= 5, `expected ≥5 R2 monsters, got ${byR(2).length}`);
  // Every early-tier monster must have at least one attack that actually resolves
  // (a typo'd / nonexistent attack name → a monster that can't act in combat).
  for (const m of [...byR(1), ...byR(2)]) {
    assert.ok(getAttacksForMonster(m).length >= 1, `${m.typeName} has no usable attack`);
  }
});

test("addMonsterType appends new types and dedupes by name", () => {
  loadData();
  const before = getMonsterTypes().length;
  assert.equal(addMonsterType({ typeName: "Zzz Test Beast", element: "Fire" }), true);
  assert.equal(getMonsterTypes().length, before + 1);
  assert.equal(addMonsterType({ typeName: "Zzz Test Beast" }), false, "duplicate name rejected");
  assert.equal(addMonsterType(null), false);
});

test("removeMonsterType drops a type from the pool", () => {
  loadData();
  addMonsterType({ typeName: "Temp Zzz Mon", element: "Fire" });
  const before = getMonsterTypes().length;
  assert.equal(removeMonsterType("Temp Zzz Mon"), true);
  assert.equal(getMonsterTypes().length, before - 1);
  assert.equal(removeMonsterType("No Such Mon"), false);
});

test("generateMonster adds a generated monster to the live pool (mocked AI, no DB)", async () => {
  loadData();
  const origKey = process.env.OPENAI_API_KEY, origFetch = global.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({
      typeName: "Gen Test Beast", element: "Water", rarity: 3,
      baseHealth: 80, baseStrength: 60, baseDefense: 50, baseSpeed: 70, basePower: 65, baseEnergy: 75, baseLuck: 40,
      healthScaling1: 1.1, healthScaling2: 0.9,
    }) } }] }),
  });
  try {
    const before = getMonsterTypes().length;
    const mt = await generateMonster();
    assert.ok(mt, "returns a monster");
    assert.equal(mt.typeName, "Gen Test Beast");
    assert.ok(mt.attack_1, "attacks assigned");
    assert.equal(getMonsterTypes().length, before + 1);
    assert.ok(getMonsterTypes().some((m) => m.typeName === "Gen Test Beast"), "added to the pool");
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
    global.fetch = origFetch;
  }
});
