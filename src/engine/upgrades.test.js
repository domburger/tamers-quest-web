import { test } from "node:test";
import assert from "node:assert/strict";
import { UPGRADE_DEFS, getUpgradeDef, upgradeLevel, upgradeCost, nextUpgradeCost, purchaseUpgrade, goldMult, vaultCapacity } from "./upgrades.js";

const prospector = getUpgradeDef("prospector");

test("upgrade cost scales geometrically; nextUpgradeCost is null at max", () => {
  assert.equal(upgradeCost(prospector, 0), prospector.baseCost);
  assert.ok(upgradeCost(prospector, 2) > upgradeCost(prospector, 1));
  const maxed = { upgrades: { prospector: prospector.maxLevel } };
  assert.equal(nextUpgradeCost(maxed, prospector), null);
});

test("purchaseUpgrade spends gold and raises the level; rejects poor / maxed", () => {
  const p = { gold: 10000, upgrades: {} };
  const before = p.gold;
  assert.equal(purchaseUpgrade(p, prospector).ok, true);
  assert.equal(upgradeLevel(p, "prospector"), 1);
  assert.equal(p.gold, before - prospector.baseCost);

  const poor = { gold: 0, upgrades: {} };
  assert.equal(purchaseUpgrade(poor, prospector).reason, "gold");
  assert.equal(upgradeLevel(poor, "prospector"), 0);

  const maxed = { gold: 999999, upgrades: { prospector: prospector.maxLevel } };
  assert.equal(purchaseUpgrade(maxed, prospector).reason, "maxed");
});

test("effect getters scale with level", () => {
  assert.equal(goldMult({ upgrades: {} }), 1);
  assert.equal(goldMult({ upgrades: { prospector: 2 } }), 1.4);
  assert.equal(vaultCapacity({ upgrades: {} }, 100), 100);
  assert.equal(vaultCapacity({ upgrades: { deepVault: 2 } }, 100), 150);
});

test("every upgrade def is well-formed", () => {
  for (const d of UPGRADE_DEFS) {
    assert.ok(d.id && d.name && d.desc, `${d.id} has id/name/desc`);
    assert.ok(d.maxLevel >= 1 && d.baseCost > 0 && d.costMult > 1);
    assert.equal(typeof d.per, "number", `${d.id} has a numeric per (drives the effect getters)`);
  }
});

test("effect getters are driven by each def's `per` (single source of truth, not hardcoded)", () => {
  // Guards against the getters drifting from UPGRADE_DEFS: the per-level magnitude
  // must equal the def's `per`, so tuning `per` actually changes the effect.
  const prosLvl3 = goldMult({ upgrades: { prospector: 3 } }) - 1;
  assert.ok(Math.abs(prosLvl3 - getUpgradeDef("prospector").per * 3) < 1e-9);
  const vault = vaultCapacity({ upgrades: { deepVault: 4 } }, 0);
  assert.equal(vault, getUpgradeDef("deepVault").per * 4);
});
