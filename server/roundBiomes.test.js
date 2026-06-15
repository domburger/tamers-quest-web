// TQ-365: the pure biome-ring rotation that gives a round a STABLE 12-biome set with `reused`
// carried over + `fresh` rotated in each round. No DB / no world needed — exercises rotateBiomeOrder
// directly (the same function generateRound drives).
import { test } from "node:test";
import assert from "node:assert/strict";
import { rotateBiomeOrder } from "./world.js";

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
