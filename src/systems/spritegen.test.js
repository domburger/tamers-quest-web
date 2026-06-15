import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { archetypeFor, visualKey, paletteFor, eyeGlowFor } from "./spritegen.js";
import { makeRng } from "../engine/rng.js";

// The procedural generator draws each monster from one of six ANIMAL ARCHETYPES
// (P5-T5 / PT1-T21 "brutal, not cute, not all egg-shaped"). These tests guard the
// pure archetype-selection logic — especially the user's DONE criterion that a
// lineup reads as several DISTINCT silhouettes — without needing a canvas.

const ARCHES = new Set(["beast", "raptor", "saurian", "leviathan", "arthropod", "brute"]);
const MONSTERS = JSON.parse(readFileSync("public/assets/data/monstertype.json", "utf8"));

// Mirror generateMonsterSprite's seeding so the test sees the SAME archetype the
// sprite would render (TQ-349: name-seeded, no element).
const archOf = (mt) => archetypeFor(mt, visualKey(mt.typeName), makeRng(mt.typeName));

test("archetypeFor returns a valid archetype for every monster in the data", () => {
  assert.ok(MONSTERS.length >= 100, "fixture sanity: full monster pool loaded");
  for (const mt of MONSTERS) {
    const a = archOf(mt);
    assert.ok(ARCHES.has(a), `${mt.typeName} → invalid archetype "${a}"`);
  }
});

// (archetypeFor is the procedural silhouette picker that BAKES every hand-authored seed monster's
// sprite at boot. AI-generated monsters don't use it — they carry an authored SVG model (mt.svg,
// TQ-245) rasterized at runtime by drawMonster (TQ-246). The old LLM-authored-shapes renderer was
// removed in the SVG cutover, TQ-242.)

test("archetypeFor is deterministic — same monster always gets the same archetype (seeded)", () => {
  for (const mt of MONSTERS.slice(0, 30)) {
    const a1 = archetypeFor(mt, visualKey(mt.typeName), makeRng(mt.typeName));
    const a2 = archetypeFor(mt, visualKey(mt.typeName), makeRng(mt.typeName));
    assert.equal(a1, a2, `${mt.typeName} must be stable across calls`);
  }
});

test("the full bestiary spans many archetypes (not one egg-shape) — the brutal-variety requirement", () => {
  const seen = new Set(MONSTERS.map(archOf));
  // 6 archetypes exist; across 115 monsters we expect nearly all of them and
  // certainly far more than the old single-blob silhouette.
  assert.ok(seen.size >= 4, `expected >=4 distinct archetypes across the pool, got ${seen.size}: ${[...seen].join(", ")}`);
});

test("any 'ten random monsters' lineup shows 4+ distinct silhouettes (DONE criterion)", () => {
  // Deterministic sliding windows of 10 across the pool — every window must clear
  // the bar, not just a lucky sample.
  let worst = 99;
  for (let i = 0; i + 10 <= MONSTERS.length; i += 5) {
    const window = MONSTERS.slice(i, i + 10);
    const distinct = new Set(window.map(archOf)).size;
    worst = Math.min(worst, distinct);
  }
  assert.ok(worst >= 4, `the weakest 10-monster window had only ${worst} distinct archetypes (need >=4)`);
});

test("keyword-named monsters map to their obvious archetype", () => {
  const mk = (typeName, description = "") => archOf({ typeName, description });
  assert.equal(mk("Stone Golem"), "brute");
  assert.equal(mk("Cave Spider"), "arthropod");
  assert.equal(mk("Frost Wyrm"), "saurian");
  assert.equal(mk("Ember Hawk"), "raptor");
  assert.equal(mk("Tide Kraken"), "leviathan");
  assert.equal(mk("Dire Wolf"), "beast");
});

const isColor = (c) => Array.isArray(c) && c.length === 3 && c.every((n) => typeof n === "number" && n >= 0 && n <= 255);

// Readability guard: every monster's name-seeded visual key must resolve to a complete
// sprite palette + a valid eye-glow colour (no accidental grey monsters).
test("every monster maps to a complete sprite palette + valid eye-glow", () => {
  for (const mt of MONSTERS) {
    const key = visualKey(mt.typeName);
    const pal = paletteFor(key);
    assert.ok(isColor(pal.base) && isColor(pal.accent) && isColor(pal.dark), `${mt.typeName}: incomplete palette`);
    assert.ok(isColor(eyeGlowFor(key)), `${mt.typeName}: bad eye-glow`);
  }
});

test("visualKey is deterministic; paletteFor falls back to a valid neutral for an unknown key", () => {
  assert.equal(visualKey("Stone Golem"), visualKey("Stone Golem"), "stable per name");
  const pal = paletteFor("definitely-not-a-key-zzz");
  assert.ok(isColor(pal.base) && isColor(pal.accent) && isColor(pal.dark), "unknown key → a valid neutral palette");
});
