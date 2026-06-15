import { test } from "node:test";
import assert from "node:assert";
import { sortMonsters, sortChainsByTier, nextSortMode, SORT_MODES, searchMonsters } from "./rosterSort.js";

// typeName → {rarity}
const TYPES = {
  Ember: { rarity: 5 },
  Wave: { rarity: 2 },
  Gale: { rarity: 4 },
};
const typeOf = (n) => TYPES[n];
const mk = (typeName, level) => ({ id: `${typeName}${level}`, typeName, level });
const ids = (arr) => arr.map((m) => m.id);

const list = [mk("Wave", 3), mk("Ember", 1), mk("Gale", 7), mk("Ember", 9)];

test("recent mode preserves input order and returns the same objects", () => {
  const out = sortMonsters(list, "recent", typeOf);
  assert.deepEqual(ids(out), ["Wave3", "Ember1", "Gale7", "Ember9"]);
  assert.strictEqual(out[0], list[0], "reference-stable (same monster objects)");
});

test("level mode sorts highest level first", () => {
  assert.deepEqual(ids(sortMonsters(list, "level", typeOf)), ["Ember9", "Gale7", "Wave3", "Ember1"]);
});

test("rarity mode sorts highest type-rarity first (stable within a rarity)", () => {
  // Ember=5, Gale=4, Wave=2; the two Embers keep input order (Ember1 before Ember9).
  assert.deepEqual(ids(sortMonsters(list, "rarity", typeOf)), ["Ember1", "Ember9", "Gale7", "Wave3"]);
});

test("does not mutate the input list", () => {
  const before = ids(list);
  sortMonsters(list, "level", typeOf);
  assert.deepEqual(ids(list), before);
});

test("missing type data sorts last, never throws", () => {
  const l = [mk("Unknown", 1), mk("Ember", 1)];
  const out = sortMonsters(l, "rarity", typeOf); // Unknown has no type → rarity 0 sorts last
  assert.deepEqual(ids(out), ["Ember1", "Unknown1"]);
});

test("nextSortMode cycles through all modes", () => {
  let m = "recent"; const seen = [m];
  for (let i = 0; i < SORT_MODES.length; i++) { m = nextSortMode(m); seen.push(m); }
  assert.deepEqual(seen, ["recent", "level", "rarity", "recent"]);
});

test("sortChainsByTier orders highest tier first, stable", () => {
  const chains = [{ def: { tier: 1 }, n: "a" }, { def: { tier: 3 }, n: "b" }, { def: { tier: 3 }, n: "c" }, { def: { tier: 2 }, n: "d" }];
  assert.deepEqual(sortChainsByTier(chains).map((c) => c.n), ["b", "c", "d", "a"]);
});

test("searchMonsters: blank query returns everything (copy, not mutating)", () => {
  const before = ids(list);
  for (const q of ["", "   ", null, undefined]) assert.deepEqual(ids(searchMonsters(list, q, typeOf)), before);
  assert.deepEqual(ids(list), before);
});

test("searchMonsters: matches type name, is case-insensitive, returns same objects", () => {
  const out = searchMonsters(list, "ember", typeOf);
  assert.deepEqual(ids(out), ["Ember1", "Ember9"]);
  assert.strictEqual(out[0], list[1], "reference-stable (same monster objects)");
  assert.deepEqual(ids(searchMonsters(list, "WAVE", typeOf)), ["Wave3"]);
});

test("searchMonsters: matches type name + custom display name; substring; no match → []", () => {
  assert.deepEqual(ids(searchMonsters(list, "wav", typeOf)), ["Wave3"]); // substring of type name
  const named = [{ id: "x", typeName: "Wave", name: "Bubbles" }];
  assert.deepEqual(ids(searchMonsters(named, "bubb", typeOf)), ["x"]); // by display name
  assert.deepEqual(ids(searchMonsters(list, "zzz", typeOf)), []);
});
