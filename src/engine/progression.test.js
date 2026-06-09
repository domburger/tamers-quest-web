// P10-T4 — shared grantXp (SP + server use one implementation).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes, getMonsterType } from "./gamedata.js";
import { getMonsterStats } from "./stats.js";
import { GAME } from "./schemas.js";
import { goldForDefeat } from "./schemas.js";
import { grantXp, xpForLevel, healToFull, healTeam, extractGold, grantExtractRewards, defeatGold, defeatEssence, chestEssence, stormDamageTeam, bumpStat } from "./progression.js";

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

test("grantXp: applies multiple level-ups from one large grant, keeping remainder (exponential curve)", () => {
  load();
  const inst = { typeName: someName(), level: 1, xp: 0, currentHealth: 1, currentEnergy: 1 };
  // 230 XP on the exponential curve: L1→2 costs xpForLevel(1)=100 (130 left), L2→3 costs
  // xpForLevel(2)=115 (15 left), L3 needs 132 > 15 → stop. (Old FLAT curve gave xp 30.)
  grantXp(inst, 230);
  assert.equal(inst.level, 3);
  assert.equal(inst.xp, 15);
});

test("xpForLevel: a fixed EXPONENTIAL per-level curve (monster-gen spec)", () => {
  assert.equal(xpForLevel(1), 100, "level 1→2 costs XP_BASE");
  assert.equal(xpForLevel(2), 115, "grows by XP_GROWTH each level");
  assert.equal(xpForLevel(3), 132);
  assert.ok(xpForLevel(20) > xpForLevel(10) && xpForLevel(10) > xpForLevel(5), "strictly increasing");
  assert.equal(xpForLevel(0), xpForLevel(1), "floors at level 1");
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

test("defeatGold = goldForDefeat(level) with no upgrades, scaled by Prospector", () => {
  assert.equal(defeatGold({}, 3), goldForDefeat(3));
  assert.equal(defeatGold({ upgrades: { prospector: 2 } }, 3), Math.round(goldForDefeat(3) * 1.4));
});

test("defeatEssence / chestEssence = base with no upgrades, scaled by Attunement", () => {
  assert.equal(defeatEssence({}), GAME.CRAFT.ESSENCE_PER_DEFEAT);
  assert.equal(chestEssence({}), GAME.CRAFT.ESSENCE_PER_CHEST);
  // attunement +20%/level → level 2 = 1.4× (matches essenceMult in upgrades.js)
  assert.equal(defeatEssence({ upgrades: { attunement: 2 } }), Math.round(GAME.CRAFT.ESSENCE_PER_DEFEAT * 1.4));
  assert.equal(chestEssence({ upgrades: { attunement: 2 } }), Math.round(GAME.CRAFT.ESSENCE_PER_CHEST * 1.4));
});

test("stormDamageTeam chips the lead monster, then the next, and reports a wipe (SP/MP single source)", () => {
  const team = [
    { currentHealth: 30 },
    { currentHealth: 20 },
  ];
  // Chips the FIRST alive monster only.
  assert.equal(stormDamageTeam(team, 10), false);
  assert.equal(team[0].currentHealth, 20);
  assert.equal(team[1].currentHealth, 20);
  // Overkill clamps to 0 and moves to the next; not a wipe while #2 survives.
  assert.equal(stormDamageTeam(team, 999), false);
  assert.equal(team[0].currentHealth, 0);
  // Now it chips #2; the final blow reports a full-team wipe.
  assert.equal(stormDamageTeam(team, 999), true);
  assert.equal(team[1].currentHealth, 0);
  // An already-dead team is reported wiped (no active monster).
  assert.equal(stormDamageTeam([{ currentHealth: 0 }], 5), true);
  assert.equal(stormDamageTeam([], 5), true);
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

test("bumpStat initializes + increments lifetime counters; matches the server contract", () => {
  const p = {};
  bumpStat(p, "runs");
  assert.deepEqual(p.stats, { runs: 1 }, "creates stats + sets to 1");
  bumpStat(p, "runs");
  bumpStat(p, "caught", 3);
  assert.equal(p.stats.runs, 2, "increments existing");
  assert.equal(p.stats.caught, 3, "honors n");
  assert.doesNotThrow(() => bumpStat(null, "runs")); // no profile → no-op
  assert.doesNotThrow(() => bumpStat(p)); // no key → no-op
  assert.equal(Object.keys(p.stats).length, 2, "no-op calls add nothing");
});
