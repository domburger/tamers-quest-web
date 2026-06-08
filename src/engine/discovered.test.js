import { test } from "node:test";
import assert from "node:assert/strict";
import { addDiscovered, markDiscovered, isDiscovered, getDiscovered, markSpeciesSeen, getSeenSpecies, markEncountered, getEncountered } from "./discovered.js";

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

test("markSpeciesSeen/getSeenSpecies: bestiary NEW-badge state, independent of discovered set", () => {
  const store = {};
  const prev = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  try {
    assert.deepEqual([...getSeenSpecies()], [], "nothing inspected yet");
    assert.equal(markSpeciesSeen("Cinder Wolf"), true, "first inspection marks it seen");
    assert.equal(markSpeciesSeen(" cinder wolf "), false, "inspecting again is a no-op (case/space-insensitive)");
    assert.deepEqual([...getSeenSpecies()], ["cinder wolf"]);
    // Seen-state is a SEPARATE key from discovered → marking seen doesn't discover, and vice-versa.
    assert.equal(isDiscovered("Cinder Wolf"), false, "seen ≠ discovered (different localStorage keys)");
  } finally {
    if (prev === undefined) delete globalThis.localStorage; else globalThis.localStorage = prev;
  }
});

test("markEncountered/getEncountered: wild-sighting set, independent of discovered + seen keys", () => {
  const store = {};
  const prev = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  try {
    assert.deepEqual([...getEncountered()], [], "nothing met yet");
    assert.equal(markEncountered("Cinder Wolf"), true, "first sighting records it");
    assert.equal(markEncountered(" cinder WOLF "), false, "same species again is a no-op (case/space-insensitive)");
    assert.deepEqual([...getEncountered()], ["cinder wolf"]);
    // Separate key from discovered(=caught) + bestiary-seen → a fought-but-fled monster reads as seen, not caught.
    assert.equal(isDiscovered("Cinder Wolf"), false, "encountered != caught");
    assert.deepEqual([...getSeenSpecies()], [], "encountered != bestiary-inspected");
  } finally {
    if (prev === undefined) delete globalThis.localStorage; else globalThis.localStorage = prev;
  }
});
