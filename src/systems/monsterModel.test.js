import { test } from "node:test";
import assert from "node:assert/strict";
import { BODY_SHAPES } from "./monsterModel.js";

// monsterModel.js was trimmed to just BODY_SHAPES on 2026-06-10: the AI builder now authors
// creatures from scratch as shape primitives (modelRender.js), so the old archetype-description
// / feature-overlay vocabulary (and its canonicalFeature/renderEnvironmentBrief helpers) was
// removed along with the tests that guarded it. BODY_SHAPES is still the renderer's fallback
// silhouette set, so it's the one thing left to pin down.

test("BODY_SHAPES is the six renderer-fallback silhouettes, in order", () => {
  assert.deepEqual(BODY_SHAPES, ["beast", "raptor", "saurian", "leviathan", "arthropod", "brute"]);
});
