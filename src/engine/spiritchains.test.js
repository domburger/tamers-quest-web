import { test } from "node:test";
import assert from "node:assert/strict";
import { chainCaptureChance, canThrow, rollChainDrop } from "./spiritchains.js";
import { GAME, grantChain, finalizeRunChains, buyChain, goldForDefeat } from "./schemas.js";
import { makeRng } from "./rng.js";

const getChain = (id) => ({ tier1: { throwCount: 3, durability: 1 } }[id]);

const chain = (o = {}) => ({
  special: o.special ?? null,
  maxRarity: o.maxRarity ?? 5,
  captureMultiplier: o.captureMultiplier ?? 1,
});

test("rarity gate: enemy above the chain's maxRarity auto-fails", () => {
  assert.equal(chainCaptureChance(0.7, chain({ maxRarity: 3 }), 4, 0.1, GAME), 0);
  assert.equal(chainCaptureChance(0.7, chain({ maxRarity: 3 }), 3, 0.1, GAME) > 0, true);
});

test("captureMultiplier scales the base chance, clamped to .95", () => {
  assert.equal(chainCaptureChance(0.4, chain({ captureMultiplier: 0.5 }), 3, 0.6, GAME), 0.2);
  // 0.7 * 1.6 = 1.12 → clamped to .95
  assert.equal(chainCaptureChance(0.7, chain({ captureMultiplier: 1.6 }), 3, 0.1, GAME), 0.95);
});

test("guaranteed special ≈1 at/below the HP threshold, normal above it", () => {
  const g = chain({ special: "guaranteed", captureMultiplier: 1 });
  assert.equal(chainCaptureChance(0.05, g, 5, GAME.SPIRIT_CHAIN.GUARANTEED_HP_PCT, GAME) > 0.99, true);
  // above the threshold it behaves like a normal chain (here base .05, mult 1)
  assert.equal(chainCaptureChance(0.05, g, 5, 0.5, GAME), 0.05);
});

test("canThrow: null throwCount is unlimited; 0 is empty; >0 is available", () => {
  assert.equal(canThrow({ throwCount: null }), true);
  assert.equal(canThrow({ throwCount: 0 }), false);
  assert.equal(canThrow({ throwCount: 2 }), true);
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

test("finalizeRunChains never leaves a player chainless after death", () => {
  const p = { chains: [{ chainId: "tier4", throwCount: 12, durability: 5, runFound: true }], equippedChainId: "tier4" };
  finalizeRunChains(p, false, getChain); // loses its only chain (run-found) → starter backfilled
  assert.equal(p.chains.length, 1);
  assert.equal(p.chains[0].chainId, GAME.SPIRIT_CHAIN.STARTER_CHAIN_ID);
  assert.equal(p.equippedChainId, GAME.SPIRIT_CHAIN.STARTER_CHAIN_ID);
});
