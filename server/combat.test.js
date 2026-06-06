import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes } from "../src/engine/gamedata.js";
import { getMonsterStats } from "../src/engine/stats.js";
import { getAttacksForMonster } from "../src/engine/gamedata.js";
import { restoreEnergyPartial, makeEnemy, ownedAttack } from "./combat.js";

function loadData() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"),
    attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"),
    items: read("item.json"),
  });
}

// Q8: between-encounter energy "breather" so a depleted team isn't stuck skipping.
test("restoreEnergyPartial tops up by the pct, never exceeding max", () => {
  loadData();
  const mt = getMonsterTypes()[0];
  const max = getMonsterStats(mt, 1).energy;

  // From empty: +50% of max.
  const drained = { typeName: mt.typeName, level: 1, currentEnergy: 0 };
  const after = restoreEnergyPartial(drained, 50);
  assert.equal(after, Math.min(max, Math.ceil(max * 0.5)));
  assert.equal(drained.currentEnergy, after);

  // Near full: capped at max, never over.
  const nearFull = { typeName: mt.typeName, level: 1, currentEnergy: max - 1 };
  assert.equal(restoreEnergyPartial(nearFull, 50), max);

  // Default pct is 50.
  const d2 = { typeName: mt.typeName, level: 1, currentEnergy: 0 };
  assert.equal(restoreEnergyPartial(d2), Math.min(max, Math.ceil(max * 0.5)));
});

test("a drained monster reaches a usable energy level after one restore", () => {
  loadData();
  const mt = getMonsterTypes()[0];
  const inst = { typeName: mt.typeName, level: 1, currentEnergy: 0 };
  restoreEnergyPartial(inst);
  // Enough to afford a typical low-cost attack (so it won't just skip its turn).
  assert.ok(inst.currentEnergy > 0);
});

// Anti-cheat (P6-T2): a client may name any attack; only the monster's own count.
test("ownedAttack honors only the monster's own attacks", () => {
  loadData();
  const mt = getMonsterTypes()[0];
  const inst = { typeName: mt.typeName, level: 1 };
  const own = getAttacksForMonster(mt);
  assert.ok(own.length > 0, "fixture monster should have attacks");

  // An owned attack resolves to the real server-side record.
  const got = ownedAttack(inst, own[0].name);
  assert.equal(got?.name, own[0].name);

  // Unknown name, and blank/missing → null (resolver treats as a skip).
  assert.equal(ownedAttack(inst, "Definitely Not A Real Attack"), null);
  assert.equal(ownedAttack(inst, ""), null);
  assert.equal(ownedAttack(inst, undefined), null);

  // A real attack that this monster does NOT have → null (the cheat we block).
  const ownNames = new Set(own.map((a) => a.name));
  const all = JSON.parse(readFileSync("./public/assets/data/attacks.json", "utf8"));
  const foreign = (Array.isArray(all) ? all : Object.values(all)).find((a) => a.name && !ownNames.has(a.name));
  if (foreign) assert.equal(ownedAttack(inst, foreign.name), null, "off-roster attack must be rejected");
});

test("makeEnemy starts at full energy (sanity)", () => {
  loadData();
  const mt = getMonsterTypes()[0];
  const e = makeEnemy({ typeName: mt.typeName, level: 3 });
  assert.equal(e.currentEnergy, getMonsterStats(mt, 3).energy);
});
