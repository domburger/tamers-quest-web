import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BODY_SHAPES, FEATURE_VOCAB, canonicalFeature, canonicalFeatures, renderEnvironmentBrief, ARCHETYPE_DESC, FEATURE_DESC,
} from "./monsterModel.js";

test("BODY_SHAPES + ARCHETYPE_DESC cover the six renderer archetypes", () => {
  assert.deepEqual(BODY_SHAPES, ["beast", "raptor", "saurian", "leviathan", "arthropod", "brute"]);
  for (const s of BODY_SHAPES) assert.ok(ARCHETYPE_DESC[s], `${s} has a description`);
});

test("every feature in the vocab has a description (prompt + renderer stay in lock-step)", () => {
  for (const f of FEATURE_VOCAB) assert.ok(FEATURE_DESC[f], `${f} has a description`);
});

test("canonicalFeature maps exact keys, aliases, and free-form phrases", () => {
  assert.equal(canonicalFeature("horns"), "horns", "exact key");
  assert.equal(canonicalFeature("Antlers"), "horns", "alias, case-insensitive");
  assert.equal(canonicalFeature("chitin"), "plates", "alias");
  assert.equal(canonicalFeature("two great curved horns"), "horns", "free-form contains-match");
  assert.equal(canonicalFeature("barbed stinger tail"), "tail_spike", "free-form contains-match");
  assert.equal(canonicalFeature("nonsense"), null, "unknown → null");
  assert.equal(canonicalFeature(""), null);
  assert.equal(canonicalFeature(null), null);
});

test("canonicalFeatures de-dupes, drops junk, and caps at 4", () => {
  assert.deepEqual(canonicalFeatures(["horns", "antlers", "armor", "armour"]), ["horns", "plates"], "synonyms collapse");
  assert.deepEqual(canonicalFeatures(["a", "b", "c", "nonsense"]).length, 0, "all-junk → []");
  assert.equal(canonicalFeatures(["horns", "spines", "plates", "tusks", "wings", "crystals"]).length, 4, "capped at 4");
  assert.deepEqual(canonicalFeatures(null), []);
  assert.deepEqual(canonicalFeatures("not-an-array"), []);
});

test("renderEnvironmentBrief lists every bodyShape + feature and names Phaser/procedural", () => {
  const brief = renderEnvironmentBrief();
  for (const s of BODY_SHAPES) assert.ok(brief.includes(s), `brief lists bodyShape ${s}`);
  for (const f of FEATURE_VOCAB) assert.ok(brief.includes(f), `brief lists feature ${f}`);
  assert.match(brief, /PROCEDURAL/i, "explains it's a procedural generator");
  assert.match(brief, /Phaser/, "names Phaser (how the sprite is reused)");
  assert.match(brief, /128x128|icon|combat|bestiary/i, "explains one sprite reused at every size");
});
