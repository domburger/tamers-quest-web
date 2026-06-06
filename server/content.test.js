import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes, addMonsterType, removeMonsterType } from "../src/engine/gamedata.js";
import { generateMonster } from "./content.js";

function loadData() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"), attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"), items: read("item.json"),
  });
}

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
