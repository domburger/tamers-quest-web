import { test } from "node:test";
import assert from "node:assert/strict";
import { addDiscovered } from "./discovered.js";

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
