import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GAME, finalizeRunChains, grantChain, buyChain, craftUpgrade,
  goldForDefeat, upgradeCost, upgradeTargetFor, createChainInstance,
  createMonsterInstance, createPlayerProfile, grantStarterInventory,
} from "./schemas.js";

// The chain economy + extraction stakes are pure, shared SP↔MP, and were untested —
// a silent regression here would corrupt the core risk/reward loot loop. `getChain`
// stub resolves any id to a minimal def (finalizeRunChains' chainless-safety fallback).
const getChain = () => ({ throwCount: 3, durability: 1 });

test("createChainInstance: copies the def's counters onto a fresh instance", () => {
  assert.deepEqual(createChainInstance("iron", { throwCount: null, durability: 3 }), { chainId: "iron", throwCount: null, durability: 3 });
});

test("finalizeRunChains: extracting BANKS run-found chains (clears the flag)", () => {
  const profile = { chains: [{ chainId: "a", runFound: true }, { chainId: "b" }], equippedChainId: "a" };
  finalizeRunChains(profile, true, getChain);
  assert.equal(profile.chains.length, 2, "nothing lost on a successful extract");
  assert.ok(profile.chains.every((c) => c.runFound === undefined), "run-found flags cleared → now permanent");
  assert.equal(profile.equippedChainId, "a");
});

test("finalizeRunChains: death FORFEITS run-found chains, keeps banked, re-points equipped", () => {
  const profile = { chains: [{ chainId: "a", runFound: true }, { chainId: "b" }], equippedChainId: "a" };
  finalizeRunChains(profile, false, getChain);
  assert.ok(!profile.chains.some((c) => c.chainId === "a"), "run-found 'a' forfeited on death");
  assert.ok(profile.chains.some((c) => c.chainId === "b"), "banked 'b' survives");
  assert.equal(profile.equippedChainId, "b", "equipped re-pointed off the dropped chain");
});

test("finalizeRunChains: death with ALL chains run-found still leaves a usable starter", () => {
  const profile = { chains: [{ chainId: "a", runFound: true }], equippedChainId: "a" };
  finalizeRunChains(profile, false, getChain);
  assert.equal(profile.chains.length, 1, "chainless-safety granted the starter");
  assert.equal(profile.chains[0].chainId, GAME.SPIRIT_CHAIN.STARTER_CHAIN_ID);
  assert.equal(profile.equippedChainId, profile.chains[0].chainId);
});

test("grantChain: adds a new instance, flags run-found loot, auto-equips when empty", () => {
  const profile = {};
  grantChain(profile, "iron", { throwCount: null, durability: 3 }, true);
  assert.equal(profile.chains.length, 1);
  assert.equal(profile.chains[0].chainId, "iron");
  assert.equal(profile.chains[0].runFound, true, "loot is provisional until extracted");
  assert.equal(profile.equippedChainId, "iron", "auto-equipped (nothing was equipped)");
});

test("grantChain: a banked (shop/craft) grant of an owned chain refills counters + clears run-found", () => {
  const profile = { chains: [{ chainId: "iron", throwCount: 1, durability: 0, runFound: true }], equippedChainId: "iron" };
  grantChain(profile, "iron", { throwCount: null, durability: 3 }, false); // runFound=false → bank grant
  assert.equal(profile.chains.length, 1, "tops up the existing instance, no duplicate");
  assert.equal(profile.chains[0].durability, 3, "counters refilled to the def maxima");
  assert.equal(profile.chains[0].runFound, undefined, "a paid refill can't be forfeited on death");
});

test("buyChain: deducts gold + banks the chain when affordable; refuses when too poor", () => {
  const rich = { gold: 100, chains: [] };
  assert.equal(buyChain(rich, { id: "iron", price: 40, throwCount: null, durability: 3 }), true);
  assert.equal(rich.gold, 60, "price deducted");
  assert.equal(rich.chains[0]?.chainId, "iron");
  assert.equal(rich.chains[0].runFound, undefined, "purchased chains are banked, not run-found");

  const poor = { gold: 10, chains: [] };
  assert.equal(buyChain(poor, { id: "iron", price: 40, durability: 3 }), false);
  assert.equal(poor.gold, 10, "no gold spent on a failed buy");
  assert.equal(poor.chains.length, 0, "nothing granted when too poor");
});

test("upgradeTargetFor: next non-special tier, or null at the top / for specials", () => {
  const defs = [{ id: "t1", tier: 1 }, { id: "t2", tier: 2 }, { id: "sp", tier: 1, special: "guaranteed" }];
  assert.equal(upgradeTargetFor(defs[0], defs)?.id, "t2");
  assert.equal(upgradeTargetFor(defs[1], defs), null, "no tier above t2 → maxed");
  assert.equal(upgradeTargetFor(defs[2], defs), null, "special chains don't upgrade");
});

test("craftUpgrade: spends essence + consumes the lower chain on success; reports failure reasons", () => {
  const defs = [{ id: "t1", tier: 1 }, { id: "t2", tier: 2 }];
  assert.equal(craftUpgrade({ chains: [{ chainId: "t2" }], essence: 999 }, "t2", defs).reason, "maxed");
  assert.equal(craftUpgrade({ chains: [], essence: 999 }, "t1", defs).reason, "owned");
  assert.equal(craftUpgrade({ chains: [{ chainId: "t1" }], essence: 0 }, "t1", defs).reason, "essence");

  const p = { chains: [{ chainId: "t1" }], essence: upgradeCost(1) + 5, equippedChainId: "t1" };
  const res = craftUpgrade(p, "t1", defs);
  assert.equal(res.ok, true);
  assert.equal(res.toId, "t2");
  assert.ok(!p.chains.some((c) => c.chainId === "t1"), "lower chain consumed");
  assert.ok(p.chains.some((c) => c.chainId === "t2"), "upgraded chain granted");
  assert.equal(p.essence, 5, "exactly the upgrade cost was spent");
});

test("goldForDefeat + upgradeCost: scale off the GAME constants (null/0 level floors to 1)", () => {
  assert.equal(goldForDefeat(5), GAME.GOLD.PER_DEFEAT_BASE + GAME.GOLD.PER_DEFEAT_PER_LEVEL * 5);
  assert.equal(goldForDefeat(0), GAME.GOLD.PER_DEFEAT_BASE + GAME.GOLD.PER_DEFEAT_PER_LEVEL * 1);
  assert.equal(upgradeCost(3), GAME.CRAFT.UPGRADE_COST_PER_TIER * 3);
});

test("createMonsterInstance: seeds HP/energy from stats; name defaults to type; tile coords optional", () => {
  const m = createMonsterInstance({ typeName: "Cinder Wolf", level: 3, stats: { health: 50, energy: 20 }, id: "x" });
  assert.equal(m.name, "Cinder Wolf", "name defaults to typeName");
  assert.equal(m.currentHealth, 50);
  assert.equal(m.currentEnergy, 20);
  assert.equal(m.xp, 0);
  assert.equal(m.status, null);
  assert.equal(m.tileX, undefined, "no tile coords unless provided");
  const placed = createMonsterInstance({ typeName: "A", name: "Rex", level: 1, stats: { health: 1, energy: 1 }, id: "y", tileX: 5, tileY: 6 });
  assert.equal(placed.name, "Rex");
  assert.equal(placed.tileX, 5);
  assert.equal(placed.tileY, 6);
});

test("createPlayerProfile: fresh profile defaults + isGuest coercion", () => {
  const p = createPlayerProfile({ id: 1, name: "Tam" });
  assert.equal(p.level, 1);
  assert.equal(p.gold, 0);
  assert.equal(p.essence, 0);
  assert.equal(p.isGuest, false);
  assert.deepEqual(p.activeMonsters, []);
  assert.deepEqual(p.vaultMonsters, []);
  assert.deepEqual(p.chains, []);
  assert.equal(p.equippedChainId, null);
  assert.equal(createPlayerProfile({ id: 2, name: "G", isGuest: 1 }).isGuest, true, "isGuest coerced to boolean");
});

test("grantStarterInventory: grants the starter chain set, idempotent, auto-equips the first", () => {
  const getChain = () => ({ throwCount: 3, durability: 1 });
  const p = { chains: [] };
  grantStarterInventory(p, getChain);
  const n = p.chains.length;
  assert.equal(n, GAME.SPIRIT_CHAIN.STARTER_CHAIN_IDS.length, "grants the full starter set");
  assert.equal(p.equippedChainId, p.chains[0].chainId, "auto-equipped the first starter");
  grantStarterInventory(p, getChain); // re-run
  assert.equal(p.chains.length, n, "idempotent — no duplicate grants");
});
