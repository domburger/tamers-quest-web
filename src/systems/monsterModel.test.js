import { test } from "node:test";
import assert from "node:assert/strict";
import { BODY_SHAPES } from "./monsterModel.js";

test("BODY_SHAPES is the six renderer-fallback silhouettes, in order", () => {
  assert.deepEqual(BODY_SHAPES, ["beast", "raptor", "saurian", "leviathan", "arthropod", "brute"]);
});
