// P10-T4 — shared grantXp (SP + server use one implementation).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes } from "./gamedata.js";
import { GAME } from "./schemas.js";
import { grantXp } from "./progression.js";

function load() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"), attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"), items: read("item.json"),
    spiritChains: read("spiritchains.json"),
  });
}
const someName = () => getMonsterTypes()[0].name;

test("grantXp: accumulates without leveling below the threshold", () => {
  load();
  const inst = { typeName: someName(), level: 1, xp: 0, currentHealth: 1, currentEnergy: 1 };
  assert.equal(grantXp(inst, GAME.XP_PER_LEVEL - 1), false);
  assert.equal(inst.level, 1);
  assert.equal(inst.xp, GAME.XP_PER_LEVEL - 1);
});

test("grantXp: levels up and heals to the new max at the threshold", () => {
  load();
  const inst = { typeName: someName(), level: 1, xp: 0, currentHealth: 1, currentEnergy: 0 };
  assert.equal(grantXp(inst, GAME.XP_PER_LEVEL), true);
  assert.equal(inst.level, 2);
  assert.equal(inst.xp, 0);
  assert.ok(inst.currentHealth > 1, "restored to new max HP on level-up");
  assert.ok(inst.currentEnergy > 0, "restored energy on level-up");
});

test("grantXp: applies multiple level-ups from one large grant, keeping remainder", () => {
  load();
  const inst = { typeName: someName(), level: 1, xp: 0, currentHealth: 1, currentEnergy: 1 };
  grantXp(inst, GAME.XP_PER_LEVEL * 2 + 30);
  assert.equal(inst.level, 3);
  assert.equal(inst.xp, 30);
});
