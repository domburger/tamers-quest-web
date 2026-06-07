import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { archetypeFor, canonicalElement, paletteFor, eyeGlowFor } from "./spritegen.js";
import { makeRng } from "../engine/rng.js";

// The procedural generator draws each monster from one of six ANIMAL ARCHETYPES
// (P5-T5 / PT1-T21 "brutal, not cute, not all egg-shaped"). These tests guard the
// pure archetype-selection logic — especially the user's DONE criterion that a
// lineup reads as several DISTINCT silhouettes — without needing a canvas.

const ARCHES = new Set(["beast", "raptor", "saurian", "leviathan", "arthropod", "brute"]);
const MONSTERS = JSON.parse(readFileSync("public/assets/data/monstertype.json", "utf8"));

// Mirror generateMonsterSprite's seeding so the test sees the SAME archetype the
// sprite would render.
const archOf = (mt) => archetypeFor(mt, canonicalElement(mt.element), makeRng(mt.typeName + "|" + mt.element));

test("archetypeFor returns a valid archetype for every monster in the data", () => {
  assert.ok(MONSTERS.length >= 100, "fixture sanity: full monster pool loaded");
  for (const mt of MONSTERS) {
    const a = archOf(mt);
    assert.ok(ARCHES.has(a), `${mt.typeName} (${mt.element}) → invalid archetype "${a}"`);
  }
});

test("archetypeFor is deterministic — same monster always gets the same archetype (seeded)", () => {
  for (const mt of MONSTERS.slice(0, 30)) {
    const a1 = archetypeFor(mt, canonicalElement(mt.element), makeRng(mt.typeName + "|" + mt.element));
    const a2 = archetypeFor(mt, canonicalElement(mt.element), makeRng(mt.typeName + "|" + mt.element));
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
  const mk = (typeName, element = "Neutral", description = "") => archOf({ typeName, element, description });
  assert.equal(mk("Stone Golem", "Earth"), "brute");
  assert.equal(mk("Cave Spider", "Poison"), "arthropod");
  assert.equal(mk("Frost Wyrm", "Ice"), "saurian");
  assert.equal(mk("Ember Hawk", "Fire"), "raptor");
  assert.equal(mk("Tide Kraken", "Water"), "leviathan");
  assert.equal(mk("Dire Wolf", "Dark"), "beast");
});

test("canonicalElement folds synonyms/dual-types to a base key", () => {
  assert.equal(canonicalElement("Ghost"), "celestial");
  assert.equal(canonicalElement("Void"), "dark");
  assert.equal(canonicalElement("Mercury"), "metal");
  assert.equal(canonicalElement("Cosmic"), "arcane");
  assert.equal(canonicalElement("Fire/Dark"), "fire"); // primary of a dual-type
  assert.equal(canonicalElement("FIRE"), "fire");       // case-insensitive
});

// Element-readability guard: every element that appears in the monster data must
// resolve to a real, complete palette and a valid eye-glow colour. If someone adds
// a new element to monstertype.json without giving it a palette/alias, monsters of
// that element silently render in the neutral grey — this catches that regression.
const DATA_ELEMENTS = [...new Set(MONSTERS.map((m) => String(m.element || "").split("/")[0].trim()).filter(Boolean))];
const isColor = (c) => Array.isArray(c) && c.length === 3 && c.every((n) => typeof n === "number" && n >= 0 && n <= 255);

test("every element in the data maps to a complete palette (no accidental grey monsters)", () => {
  const neutral = paletteFor("definitely-not-an-element-zzz");
  for (const el of DATA_ELEMENTS) {
    const pal = paletteFor(el);
    assert.ok(isColor(pal.base) && isColor(pal.accent) && isColor(pal.dark), `${el}: incomplete palette`);
    // None of the real data elements should fall through to the neutral grey
    // fallback — that would mean an unmapped element (a readability bug).
    assert.notEqual(pal, neutral, `${el} fell through to the neutral fallback — add a palette or alias`);
  }
});

test("eyeGlowFor returns a valid RGB triple for every element in the data", () => {
  for (const el of DATA_ELEMENTS) {
    const glow = eyeGlowFor(canonicalElement(el));
    assert.ok(isColor(glow), `${el}: bad eye-glow ${JSON.stringify(glow)}`);
  }
});
