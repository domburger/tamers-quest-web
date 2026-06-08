import { test } from "node:test";
import assert from "node:assert/strict";
import { addDiscovered, markDiscovered, isDiscovered, getDiscovered } from "./discovered.js";

test("addDiscovered marks a brand-new species as new and appends it", () => {
  const { list, isNew } = addDiscovered([], "Cinder Wolf");
  assert.equal(isNew, true);
  assert.deepEqual(list, ["cinder wolf"]);
});

test("addDiscovered is idempotent — a known species is not new", () => {
  const { list, isNew } = addDiscovered(["cinder wolf"], "Cinder Wolf");
  assert.equal(isNew, false);
  assert.deepEqual(list, ["cinder wolf"]); // no duplicate
});

test("addDiscovered is case- and whitespace-insensitive", () => {
  const r = addDiscovered(["thunder ram"], "  THUNDER RAM ");
  assert.equal(r.isNew, false);
});

test("addDiscovered normalizes a messy incoming list and dedupes", () => {
  const { list } = addDiscovered([" Phantom Mantis ", "phantom mantis"], "Thornvine Treant");
  assert.deepEqual(list, ["phantom mantis", "thornvine treant"]);
});

test("addDiscovered ignores empty/blank typeNames without mutating", () => {
  const before = ["cinder wolf"];
  const { list, isNew } = addDiscovered(before, "   ");
  assert.equal(isNew, false);
  assert.deepEqual(list, ["cinder wolf"]);
});

test("addDiscovered tolerates a non-array list", () => {
  const { list, isNew } = addDiscovered(null, "Cinder Wolf");
  assert.equal(isNew, true);
  assert.deepEqual(list, ["cinder wolf"]);
});

test("markDiscovered/isDiscovered/getDiscovered: persistent, case-insensitive milestone set", () => {
  // Mock localStorage so the persistence path runs (node has none → load/persist no-op).
  const store = {};
  const prev = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  try {
    assert.equal(isDiscovered("Cinder Wolf"), false, "nothing discovered yet");
    assert.equal(markDiscovered("Cinder Wolf"), true, "first-ever catch → the NEW SPECIES milestone");
    assert.equal(markDiscovered("  cinder WOLF "), false, "same species (case/space-insensitive) → not new again");
    assert.equal(isDiscovered("CINDER WOLF"), true, "now permanently discovered (survives collection churn)");
    markDiscovered("Thunder Ram");
    assert.deepEqual([...getDiscovered()].sort(), ["cinder wolf", "thunder ram"], "snapshot of every discovered species");
    assert.equal(markDiscovered("   "), false, "a blank typeName is never a milestone");
  } finally {
    if (prev === undefined) delete globalThis.localStorage; else globalThis.localStorage = prev;
  }
});
