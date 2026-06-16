// TQ-365: the pure biome-ring rotation that gives a round a STABLE 12-biome set with `reused`
// carried over + `fresh` rotated in each round. No DB / no world needed — exercises rotateBiomeOrder
// directly (the same function generateRound drives).
import { test } from "node:test";
import assert from "node:assert/strict";
import { rotateBiomeOrder, computeGenShortfall, ensureGeneratedShare } from "./world.js";

test("TQ-365: first build seeds the ring without rotating (set = first N)", () => {
  const { order, set } = rotateBiomeOrder([], ["a", "b", "c", "d"], { total: 3, fresh: 1, initialized: false });
  assert.deepEqual(set, ["a", "b", "c"]);
  assert.deepEqual(order, ["a", "b", "c", "d"]);
});

test("TQ-365: rotation reuses (total-fresh) and brings `fresh` in from the bench", () => {
  const r1 = rotateBiomeOrder(["a", "b", "c", "d"], ["a", "b", "c", "d"], { total: 3, fresh: 1, initialized: true });
  assert.deepEqual(r1.set, ["b", "c", "d"]);      // b,c reused (oldest a dropped) + d new from bench
  assert.deepEqual(r1.order, ["b", "c", "d", "a"]); // a goes to the bench
  const r2 = rotateBiomeOrder(r1.order, ["a", "b", "c", "d"], { total: 3, fresh: 1, initialized: true });
  assert.deepEqual(r2.set, ["c", "d", "a"]);       // keeps cycling through the whole pool
});

test("TQ-365: no bench (pool <= total) → the set cannot change", () => {
  const r = rotateBiomeOrder(["a", "b", "c"], ["a", "b", "c"], { total: 3, fresh: 1, initialized: true });
  assert.deepEqual(r.set, ["a", "b", "c"]);
});

test("TQ-365: reconciles pool changes — drops removed biomes, benches newly generated ones", () => {
  // prev ring a,b,c,d; pool now b,c,d,e (a removed, e added). total 3, fresh 1.
  const r = rotateBiomeOrder(["a", "b", "c", "d"], ["b", "c", "d", "e"], { total: 3, fresh: 1, initialized: true });
  // filter→ b,c,d ; append e → b,c,d,e ; rotate 1 → c,d,e,b ; set = c,d,e
  assert.deepEqual(r.order, ["c", "d", "e", "b"]);
  assert.deepEqual(r.set, ["c", "d", "e"]);
});

test("TQ-365: default 12/1 composition → exactly 11 reused + 1 new each round", () => {
  const pool = Array.from({ length: 13 }, (_, i) => "b" + i);
  const init = rotateBiomeOrder([], pool, { total: 12, fresh: 1, initialized: false });
  const set1 = init.set;
  const next = rotateBiomeOrder(init.order, pool, { total: 12, fresh: 1, initialized: true });
  const set2 = next.set;
  assert.equal(set1.length, 12);
  assert.equal(set2.length, 12);
  assert.equal(set2.filter((n) => set1.includes(n)).length, 11, "expected 11 reused");
  assert.equal(set2.filter((n) => !set1.includes(n)).length, 1, "expected 1 new");
});

test("ensureGeneratedShare: pulls benched generated biomes into a built-in-only set (so gen tiles appear)", () => {
  // order ring = 6 built-ins then 6 generated; the round set is the first 6 (all built-in).
  const order = ["B1", "B2", "B3", "B4", "B5", "B6", "G1", "G2", "G3", "G4", "G5", "G6"];
  const set = ["B1", "B2", "B3", "B4", "B5", "B6"]; // 0 generated
  const generated = new Set(["G1", "G2", "G3", "G4", "G5", "G6"]);
  const out = ensureGeneratedShare(set, order, generated, { total: 6 }); // floor = 2
  const gen = out.filter((n) => generated.has(n));
  assert.equal(gen.length, 2, "guarantees floor(total/3)=2 generated biomes");
  assert.deepEqual([...gen].sort(), ["G1", "G2"], "pulls in the earliest benched generated biomes");
  assert.deepEqual(out.slice(0, 4), ["B1", "B2", "B3", "B4"], "swaps the TAIL built-ins, keeps the head reused");
  assert.equal(out.length, set.length, "set size unchanged");
});

test("ensureGeneratedShare: no-op when the floor is already met or no generated exist", () => {
  const order = ["B1", "B2", "G1", "G2"];
  const generated = new Set(["G1", "G2"]);
  // already has >= floor generated
  assert.deepEqual(ensureGeneratedShare(["G1", "B1", "B2"], order, generated, { total: 3 }), ["G1", "B1", "B2"]);
  // no generated in the pool at all → unchanged
  assert.deepEqual(ensureGeneratedShare(["B1", "B2", "B3"], ["B1", "B2", "B3"], new Set(), { total: 3 }), ["B1", "B2", "B3"]);
});

test("ensureGeneratedShare: caps at the number of generated biomes actually available", () => {
  const order = ["B1", "B2", "B3", "B4", "B5", "B6", "G1"]; // only 1 generated
  const set = ["B1", "B2", "B3", "B4", "B5", "B6"];
  const out = ensureGeneratedShare(set, order, new Set(["G1"]), { total: 6 }); // floor 2 but only 1 avail
  assert.equal(out.filter((n) => n === "G1").length, 1, "brings in the one available generated biome");
});

const COMP = { biomesPerRound: 12, newBiomesPerRound: 1, monstersPerBiome: 16, tilesCollidablePerBiome: 4, tilesNonCollidablePerBiome: 8, maxNewMonstersPerRound: 30 };

test("TQ-368: computeGenShortfall — biome bench, monster floor, per-biome tile split", () => {
  const need = computeGenShortfall(COMP, {
    biomes: 12, // target 12 + 1 bench = 13 → short 1
    monsters: 10, // floor 16 → short 6
    tileSplit: { Forest: { collidable: 4, walk: 8 }, Desert: { collidable: 1, walk: 2 } },
  });
  assert.equal(need.biomes, 1);
  assert.equal(need.monsters, 6);
  assert.equal(need.tiles.Forest, undefined, "fully-stocked biome is omitted");
  assert.deepEqual(need.tiles.Desert, { collidable: 3, walk: 6 });
});

test("TQ-368: no shortfall when every pool meets its target", () => {
  const need = computeGenShortfall(COMP, { biomes: 13, monsters: 20, tileSplit: { A: { collidable: 5, walk: 9 } } });
  assert.equal(need.biomes, 0);
  assert.equal(need.monsters, 0);
  assert.deepEqual(need.tiles, {});
});
