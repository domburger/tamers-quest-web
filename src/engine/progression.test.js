// P10-T4 — shared grantXp (SP + server use one implementation).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes, getMonsterType } from "./gamedata.js";
import { getMonsterStats } from "./stats.js";
import { GAME } from "./schemas.js";
import { grantXp, healToFull, healTeam, extractGold, grantExtractRewards } from "./progression.js";

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

test("healToFull restores HP/energy to the level max and clears status", () => {
  load();
  const name = someName();
  const inst = { typeName: name, level: 2, xp: 0, currentHealth: 1, currentEnergy: 0, status: "burn" };
  healToFull(inst);
  const st = getMonsterStats(getMonsterType(name), 2);
  assert.equal(inst.currentHealth, st.health);
  assert.equal(inst.currentEnergy, st.energy);
  assert.equal(inst.status, null);
});

test("healTeam heals every member (P10-T3 extract parity)", () => {
  load();
  const name = someName();
  const team = [
    { typeName: name, level: 1, currentHealth: 1, currentEnergy: 1, status: "poison" },
    { typeName: name, level: 1, currentHealth: 0, currentEnergy: 0 },
  ];
  healTeam(team);
  for (const m of team) assert.ok(m.currentHealth > 1 && m.status == null);
});

test("extractGold = base PER_EXTRACT with no upgrades, scaled by Prospector", () => {
  assert.equal(extractGold({}), GAME.GOLD.PER_EXTRACT);
  // prospector +20%/level → level 2 = 1.4× (matches goldMult in upgrades.js)
  assert.equal(extractGold({ upgrades: { prospector: 2 } }), Math.round(GAME.GOLD.PER_EXTRACT * 1.4));
});

test("grantExtractRewards heals survivors and banks extract gold (SP/MP single source — P10-T3)", () => {
  load();
  const name = someName();
  const profile = {
    gold: 5,
    activeMonsters: [{ typeName: name, level: 1, currentHealth: 1, currentEnergy: 0, status: "burn" }],
  };
  const granted = grantExtractRewards(profile);
  assert.equal(granted, GAME.GOLD.PER_EXTRACT, "returns the gold granted");
  assert.equal(profile.gold, 5 + GAME.GOLD.PER_EXTRACT, "adds to existing gold");
  const m = profile.activeMonsters[0];
  assert.ok(m.currentHealth > 1 && m.status == null, "team healed to full");
});
