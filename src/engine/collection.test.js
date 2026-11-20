import { test } from "node:test";
import assert from "node:assert/strict";
import { newSpeciesCount } from "./collection.js";

// caughtSpeciesSet/newSpeciesCount read getDiscovered/getSeenSpecies (localStorage).
// Node has none, so those degrade to empty sets — perfect for testing the held-list
// union + the counting formula in isolation.

test("newSpeciesCount counts caught-but-unseen species", () => {
  const allTypes = [{ typeName: "Cinder Wolf" }, { typeName: "Thunder Ram" }, { typeName: "Phantom Mantis" }];
  const caught = new Set(["cinder wolf", "thunder ram"]);
  const seen = new Set(["cinder wolf"]);
  // Cinder Wolf caught+seen → not new; Thunder Ram caught+unseen → NEW; Phantom not caught.
  assert.equal(newSpeciesCount(allTypes, caught, seen), 1);
});

test("newSpeciesCount is 0 when everything caught has been seen", () => {
  const allTypes = [{ typeName: "A" }, { typeName: "B" }];
  assert.equal(newSpeciesCount(allTypes, new Set(["a", "b"]), new Set(["a", "b"])), 0);
});

test("newSpeciesCount handles empty inputs", () => {
  assert.equal(newSpeciesCount([], new Set(), new Set()), 0);
  assert.equal(newSpeciesCount(null, new Set(["a"]), new Set()), 0);
});
