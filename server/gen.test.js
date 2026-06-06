import { test } from "node:test";
import assert from "node:assert/strict";
import { getMonsterStats } from "../src/engine/stats.js";
import { makeRng } from "../src/engine/rng.js";
import { normalizeGeneratedMonster, assignAttacks, pickReuseOrGenerate } from "./gen.js";

const STAT_KEYS = ["Health", "Strength", "Defense", "Speed", "Power", "Energy", "Luck"];

test("normalizeGeneratedMonster keeps a good record and fills all stat fields", () => {
  const raw = {
    typeName: "Cinder Wisp", element: "Fire", rarity: 3, size: 2,
    description: "A drifting ember.", baseHealth: 90, baseStrength: 70,
    healthScaling1: 1.1, healthScaling2: 0.9,
  };
  const mt = normalizeGeneratedMonster(raw, { id: 500 });
  assert.equal(mt.typeName, "Cinder Wisp");
  assert.equal(mt.element, "Fire");
  assert.equal(mt.rarity, 3);
  assert.equal(mt.id, 500);
  // Every base + scaling field exists and getMonsterStats yields finite numbers.
  for (const k of STAT_KEYS) {
    assert.equal(typeof mt[`base${k}`], "number");
    assert.equal(typeof mt[`${k.toLowerCase()}Scaling1`], "number");
    assert.equal(typeof mt[`${k.toLowerCase()}Scaling2`], "number");
  }
  const st = getMonsterStats(mt, 5);
  for (const v of Object.values(st)) assert.ok(Number.isFinite(v) && v >= 1, "stat is a usable number");
});

test("normalizeGeneratedMonster clamps garbage and supplies defaults", () => {
  const mt = normalizeGeneratedMonster({
    rarity: 99, size: -4, baseHealth: "abc", baseStrength: 1e9,
    healthScaling1: NaN, healthScaling2: Infinity, element: 42,
  }, {});
  assert.equal(mt.rarity, 5, "rarity clamped to 1..5");
  assert.equal(mt.size, 1, "size clamped to >=1");
  assert.equal(mt.baseHealth, 60, "non-numeric base → default");
  assert.equal(mt.baseStrength, 400, "huge base → clamped");
  assert.equal(mt.healthScaling1, 1, "NaN scaling → default");
  assert.equal(mt.healthScaling2, 1, "non-finite (Infinity) scaling → default");
  assert.equal(mt.element, "Normal", "non-string element → default");
  assert.ok(mt.typeName, "always has a name");
  // Still consumable.
  for (const v of Object.values(getMonsterStats(mt, 3))) assert.ok(Number.isFinite(v));
});

test("normalizeGeneratedMonster de-duplicates names against the existing pool", () => {
  const existingNames = new Set(["Cinder Wisp", "Cinder Wisp 2"]);
  const mt = normalizeGeneratedMonster({ typeName: "Cinder Wisp" }, { existingNames });
  assert.equal(mt.typeName, "Cinder Wisp 3");
});

test("assignAttacks picks 4 distinct attacks, preferring the monster's element", () => {
  const pool = [];
  for (let i = 0; i < 5; i++) pool.push({ name: `Fire ${i}`, elementalType: "Fire" });
  for (let i = 0; i < 5; i++) pool.push({ name: `Water ${i}`, elementalType: "Water" });
  const mt = normalizeGeneratedMonster({ typeName: "Blaze", element: "Fire" }, {});
  assignAttacks(mt, pool, makeRng(7).next);
  const chosen = [mt.attack_1, mt.attack_2, mt.attack_3, mt.attack_4];
  assert.equal(new Set(chosen).size, 4, "4 distinct attacks");
  assert.ok(chosen.every((n) => n.startsWith("Fire ")), "all same-element when enough exist");
});

test("assignAttacks handles a small/empty pool gracefully", () => {
  const mt = normalizeGeneratedMonster({ typeName: "X", element: "Fire" }, {});
  assignAttacks(mt, [{ name: "Only", elementalType: "Water" }], makeRng(1).next);
  assert.equal(mt.attack_1, "Only");
  assert.equal(mt.attack_2, null);
  const mt2 = normalizeGeneratedMonster({ typeName: "Y" }, {});
  assignAttacks(mt2, [], makeRng(1).next);
  assert.equal(mt2.attack_1, null);
});

test("pickReuseOrGenerate forces generation on an empty pool", () => {
  assert.equal(pickReuseOrGenerate(0, makeRng(1).next), "generate");
  assert.equal(pickReuseOrGenerate(50, () => 0.99, 90), "generate"); // above the reuse threshold
  assert.equal(pickReuseOrGenerate(50, () => 0.0, 90), "reuse");
});

test("pickReuseOrGenerate reuses ~90% on a populated pool", () => {
  const rng = makeRng(12345);
  let reuse = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) if (pickReuseOrGenerate(100, rng.next, 90) === "reuse") reuse++;
  const pct = (reuse / N) * 100;
  assert.ok(pct > 85 && pct < 95, `~90% reuse, got ${pct.toFixed(1)}%`);
});
