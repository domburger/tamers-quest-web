import { test } from "node:test";
import assert from "node:assert/strict";
import { canThrow, rollChainDrop, clusterTargets } from "./spiritchains.js";
import { GAME, grantChain, finalizeRunChains, buyChain, goldForDefeat, craftUpgrade, upgradeTargetFor, upgradeCost } from "./schemas.js";
import { makeRng } from "./rng.js";

const getChain = (id) => ({ tier1: { throwCount: 3, durability: 1 } }[id]);

// Capture chance/feasibility (chainCaptureChance / chainCatchSummary) was removed when
// catching became AI-evaluated (no rarity gate or formula — server/ai.js aiResolveCatch),
// so those tests are gone; the throw/loot helpers below remain pure shared math.

test("canThrow: throwable while capture charges remain (throws are free/boomerang)", () => {
  // Map throws no longer cost throwCount (boomerang); durability (capture charges) gates use.
  assert.equal(canThrow({ durability: 1 }), true);
  assert.equal(canThrow({ durability: 5, throwCount: 0 }), true); // 0 throwCount no longer blocks
  assert.equal(canThrow({ durability: 0 }), false); // no charges left
  assert.equal(canThrow({ durability: null }), true); // unlimited charges
  assert.equal(canThrow(null), false);
});

test("rollChainDrop respects dropWeight (0/missing never drops) and returns null when nothing droppable", () => {
  assert.equal(rollChainDrop([], makeRng(1)), null);
  assert.equal(rollChainDrop([{ id: "x" }, { id: "y", dropWeight: 0 }], makeRng(1)), null);
  // Only "b" is droppable → always picked, regardless of rng.
  for (const seed of [1, 2, 99, 12345]) {
    assert.equal(rollChainDrop([{ id: "a", dropWeight: 0 }, { id: "b", dropWeight: 5 }], makeRng(seed)).id, "b");
  }
});

test("rollChainDrop is weighted: heavy weight dominates over many rolls", () => {
  const defs = [{ id: "rare", dropWeight: 1 }, { id: "common", dropWeight: 99 }];
  let common = 0;
  for (let i = 0; i < 400; i++) if (rollChainDrop(defs, makeRng(i)).id === "common") common++;
  assert.ok(common > 340, `common should dominate (~99%), got ${common}/400`);
});

test("grantChain adds a new chain and auto-equips when none equipped; duplicates refill counters", () => {
  const def2 = { throwCount: 5, durability: 2 };
  const p = { chains: [], equippedChainId: null };
  grantChain(p, "tier2", def2);
  assert.equal(p.chains.length, 1);
  assert.equal(p.equippedChainId, "tier2"); // auto-equipped (nothing was equipped)

  // Deplete it, then a duplicate pickup refills to the definition maxima (no stacking).
  p.chains[0].throwCount = 0; p.chains[0].durability = 0;
  grantChain(p, "tier2", def2);
  assert.equal(p.chains.length, 1, "no duplicate instance");
  assert.equal(p.chains[0].throwCount, 5);
  assert.equal(p.chains[0].durability, 2);

  // A second distinct chain does not change the equipped one.
  grantChain(p, "tier1", { throwCount: 3, durability: 1 });
  assert.equal(p.chains.length, 2);
  assert.equal(p.equippedChainId, "tier2");
});

test("grantChain marks run-found instances; finalizeRunChains keeps on extract, drops on death", () => {
  const banked = { chains: [{ chainId: "tier1", throwCount: 3, durability: 1 }], equippedChainId: "tier1" };
  grantChain(banked, "tier4", { throwCount: 12, durability: 5 }, true); // found in-run
  assert.equal(banked.chains.find((c) => c.chainId === "tier4").runFound, true);

  // Extract → run-found chains banked (flag cleared), nothing lost.
  const kept = JSON.parse(JSON.stringify(banked));
  finalizeRunChains(kept, true, getChain);
  assert.equal(kept.chains.length, 2);
  assert.ok(!kept.chains.some((c) => c.runFound), "flags cleared on extract");

  // Death → run-found chain dropped, banked tier1 survives, still equipped + usable.
  const died = JSON.parse(JSON.stringify(banked));
  finalizeRunChains(died, false, getChain);
  assert.ok(!died.chains.some((c) => c.chainId === "tier4"), "run-found lost on death");
  assert.ok(died.chains.some((c) => c.chainId === "tier1"), "banked chain survives");
  assert.equal(died.equippedChainId, "tier1");
});

test("grantChain: a BANK grant (runFound=false) clears a provisional flag on an existing instance; a loot dup keeps it", () => {
  // A provisional (run-found) chain that is then bank-granted (bought/crafted) must
  // become permanent — otherwise the paid-for refill would be wrongly lost on death.
  const p = { chains: [{ chainId: "tier1", throwCount: 1, durability: 1, runFound: true }], equippedChainId: "tier1" };
  grantChain(p, "tier1", { throwCount: 3, durability: 1 }, false); // bank grant (shop/craft)
  const c = p.chains.find((x) => x.chainId === "tier1");
  assert.equal(c.throwCount, 3, "counters refilled");
  assert.ok(!("runFound" in c), "bank grant clears the provisional flag (now permanent)");

  // A loot grant (runFound=true) of a chain you already own does NOT newly mark a
  // banked dupe, and leaves a still-provisional one provisional.
  const banked = { chains: [{ chainId: "tier2", throwCount: 5, durability: 2 }], equippedChainId: "tier2" };
  grantChain(banked, "tier2", { throwCount: 5, durability: 2 }, true); // loot dup of a banked chain
  assert.ok(!("runFound" in banked.chains[0]), "looting a dup of a banked chain leaves it banked");
});

test("clusterTargets returns nearest in-radius candidates, closest first, capped", () => {
  const origin = { x: 0, y: 0 };
  const cands = [
    { id: "near", x: 30, y: 0 },
    { id: "mid", x: 90, y: 0 },
    { id: "far", x: 500, y: 0 }, // outside radius
    { id: "near2", x: 0, y: 50 },
  ];
  const got = clusterTargets(origin, cands, 120, 2);
  assert.deepEqual(got.map((c) => c.id), ["near", "near2"]); // 2 closest within 120
  assert.equal(clusterTargets(origin, cands, 120, 0).length, 0);
  assert.equal(clusterTargets(origin, [], 120, 3).length, 0);
});

test("goldForDefeat scales with monster level", () => {
  assert.equal(goldForDefeat(1), GAME.GOLD.PER_DEFEAT_BASE + GAME.GOLD.PER_DEFEAT_PER_LEVEL);
  assert.ok(goldForDefeat(5) > goldForDefeat(1));
});

test("buyChain deducts gold and banks the chain when affordable; rejects when too poor", () => {
  const def = { id: "tier3", price: 160, throwCount: 8, durability: 3 };
  const rich = { gold: 200, chains: [], equippedChainId: null };
  assert.equal(buyChain(rich, def), true);
  assert.equal(rich.gold, 40);
  const bought = rich.chains.find((c) => c.chainId === "tier3");
  assert.ok(bought && !bought.runFound, "purchased chains are permanent, not run-found");

  const poor = { gold: 10, chains: [], equippedChainId: null };
  assert.equal(buyChain(poor, def), false);
  assert.equal(poor.gold, 10, "no gold spent on a failed purchase");
  assert.equal(poor.chains.length, 0);
});

// Minimal chain defs covering base tiers + a special (no JSON needed).
const CRAFT_DEFS = [
  { id: "tier1", tier: 1, throwCount: 3, durability: 1 },
  { id: "tier2", tier: 2, throwCount: 5, durability: 2 },
  { id: "tier3", tier: 3, throwCount: 8, durability: 3 },
  { id: "tier5", tier: 5, throwCount: 20, durability: 8 },
  { id: "multi", tier: 6, special: "multi", throwCount: 5, durability: 5 },
];

test("upgradeTargetFor / upgradeCost: base tiers chain up; specials + top tier have none", () => {
  assert.equal(upgradeTargetFor(CRAFT_DEFS[0], CRAFT_DEFS).id, "tier2"); // tier1 → tier2
  assert.equal(upgradeTargetFor(CRAFT_DEFS[2], CRAFT_DEFS), null); // tier3 → no tier4 in fixture
  assert.equal(upgradeTargetFor(CRAFT_DEFS[3], CRAFT_DEFS), null); // tier5 → no tier6 base
  assert.equal(upgradeTargetFor(CRAFT_DEFS[4], CRAFT_DEFS), null); // special → none
  assert.equal(upgradeCost(1), GAME.CRAFT.UPGRADE_COST_PER_TIER);
  assert.equal(upgradeCost(3), GAME.CRAFT.UPGRADE_COST_PER_TIER * 3);
});

test("craftUpgrade: spends gold + consumes the lower chain to grant the next tier", () => {
  const p = { gold: 100, chains: [{ chainId: "tier1", throwCount: 3, durability: 1 }], equippedChainId: "tier1" };
  const r = craftUpgrade(p, "tier1", CRAFT_DEFS);
  assert.equal(r.ok, true);
  assert.equal(r.toId, "tier2");
  assert.equal(p.gold, 100 - upgradeCost(1));
  assert.ok(!p.chains.some((c) => c.chainId === "tier1"), "lower chain consumed");
  assert.ok(p.chains.some((c) => c.chainId === "tier2"), "upgraded chain granted");
  assert.equal(p.equippedChainId, "tier2", "equip re-points to the upgrade");
});

test("craftUpgrade rejects when poor / unowned / maxed", () => {
  assert.equal(craftUpgrade({ gold: 0, chains: [{ chainId: "tier1", throwCount: 3, durability: 1 }] }, "tier1", CRAFT_DEFS).reason, "gold");
  assert.equal(craftUpgrade({ gold: 999, chains: [] }, "tier1", CRAFT_DEFS).reason, "owned");
  assert.equal(craftUpgrade({ gold: 999, chains: [{ chainId: "tier5", throwCount: 20, durability: 8 }] }, "tier5", CRAFT_DEFS).reason, "maxed");
});

test("finalizeRunChains never leaves a player chainless after death", () => {
  const p = { chains: [{ chainId: "tier4", throwCount: 12, durability: 5, runFound: true }], equippedChainId: "tier4" };
  finalizeRunChains(p, false, getChain); // loses its only chain (run-found) → starter backfilled
  assert.equal(p.chains.length, 1);
  assert.equal(p.chains[0].chainId, GAME.SPIRIT_CHAIN.STARTER_CHAIN_ID);
  assert.equal(p.equippedChainId, GAME.SPIRIT_CHAIN.STARTER_CHAIN_ID);
});
