import { test } from "node:test";
import assert from "node:assert/strict";
import { getMonsterStats } from "../src/engine/stats.js";
import { makeRng } from "../src/engine/rng.js";
import { normalizeGeneratedMonster, normalizeGenAttacks, assignAttacks, pickReuseOrGenerate } from "./gen.js";
import { MONSTER_ANIMS } from "../src/systems/monsterAnim.js";

// gen.js is now LLM-free CORE helpers only — the v1 single-call generator (aiGenerateMonster /
// buildMonsterPrompt) was removed 2026-06-09 (generation is the multi-agent pipeline; its live
// path is covered by genStages.test.js / genPipeline.test.js). These tests cover the pure helpers.

const STAT_KEYS = ["Health", "Strength", "Defense", "Speed", "Power", "Energy", "Luck"];

test("normalizeGeneratedMonster declares the standard animation set (idle/walk/attack)", () => {
  const mt = normalizeGeneratedMonster({ typeName: "Cinder Stalker", element: "Fire" }, {});
  assert.deepEqual(mt.animations, MONSTER_ANIMS, "every generated monster declares the 3 standard clips");
  assert.deepEqual(mt.animations, ["idle", "walk", "attack"]);
  // a fresh COPY (not the shared module array) so per-monster edits can't mutate the global set
  assert.notEqual(mt.animations, MONSTER_ANIMS);
});

test("normalizeGenAttacks: keeps up to 4 clean {title, description}, drops junk", () => {
  const r = normalizeGenAttacks([
    { title: "Ember Lash", description: "A whip of fire that burns the target for a few turns." },
    { title: "", description: "no title -> dropped" },
    { title: "No Desc" },
    { title: "Cinder Burst", description: "Bursts for moderate Fire damage to one foe." },
    { title: "Ash Veil", description: "Cloaks itself, lowering the foe's accuracy." },
    { title: "Pyre Roar", description: "Heavy Fire hit; may leave Burn." },
    { title: "Overflow", description: "5th -> capped at 4" },
  ]);
  assert.equal(r.length, 4, "exactly 4 valid attacks kept (junk dropped, capped at 4)");
  assert.deepEqual(Object.keys(r[0]), ["title", "description"]);
  assert.equal(normalizeGenAttacks(null).length, 0);
  assert.equal(normalizeGenAttacks("nope").length, 0);
});

test("normalizeGeneratedMonster: carries the designer's generated attacks + visualDescription", () => {
  const mt = normalizeGeneratedMonster({
    typeName: "Magma Crab", element: "Fire", rarity: 4,
    visualDescription: "A hulking armored crab with cracked obsidian shell glowing molten orange.",
    attacks: [
      { title: "Claw Crush", description: "Bludgeons with a heavy claw for high physical damage." },
      { title: "Magma Spit", description: "Spews lava; Fire damage that may Burn." },
      { title: "Shell Guard", description: "Hardens its shell, sharply raising defense for a turn." },
      { title: "Ember Skitter", description: "Darts in for a quick low-power Fire jab." },
    ],
  }, { id: 7 });
  assert.equal(mt.genAttacks.length, 4, "4 generated attacks stored");
  assert.equal(mt.genAttacks[0].title, "Claw Crush");
  assert.ok(mt.genAttacks[1].description.includes("Fire"));
  assert.ok(mt.visualDescription.startsWith("A hulking armored crab"), "visual description kept");
});

test("normalizeGeneratedMonster keeps a good record and fills all stat fields", () => {
  const raw = {
    typeName: "Cinder Wisp", element: "Fire", rarity: 3, size: 2,
    description: "A drifting ember.", baseHealth: 90, baseStrength: 70,
    healthScaling1: 1.1, healthScaling2: 0.9,
  };
  const mt = normalizeGeneratedMonster(raw, { id: 500 });
  assert.equal(mt.typeName, "Cinder Wisp");
  assert.equal(mt.element, "Fire");
  assert.equal(mt.rarity, 3);
  assert.equal(mt.id, 500);
  // Every base + scaling field exists and getMonsterStats yields finite numbers.
  for (const k of STAT_KEYS) {
    assert.equal(typeof mt[`base${k}`], "number");
    assert.equal(typeof mt[`${k.toLowerCase()}Scaling1`], "number");
    assert.equal(typeof mt[`${k.toLowerCase()}Scaling2`], "number");
  }
  const st = getMonsterStats(mt, 5);
  for (const v of Object.values(st)) assert.ok(Number.isFinite(v) && v >= 1, "stat is a usable number");
});

test("normalizeGeneratedMonster clamps garbage and supplies defaults", () => {
  const mt = normalizeGeneratedMonster({
    rarity: 99, size: -4, baseHealth: "abc", baseStrength: 1e9,
    healthScaling1: NaN, healthScaling2: Infinity, element: 42,
  }, {});
  assert.equal(mt.rarity, 5, "rarity clamped to 1..5");
  assert.equal(mt.size, 1, "size clamped to >=1");
  assert.equal(mt.baseHealth, 60, "non-numeric base → default");
  assert.equal(mt.baseStrength, 400, "huge base → clamped");
  assert.equal(mt.healthScaling1, 1, "NaN scaling → default");
  assert.equal(mt.healthScaling2, 1, "non-finite (Infinity) scaling → default");
  assert.equal(mt.element, "Normal", "non-string element → default");
  assert.ok(mt.typeName, "always has a name");
  // Still consumable.
  for (const v of Object.values(getMonsterStats(mt, 3))) assert.ok(Number.isFinite(v));
});

test("normalizeGeneratedMonster caps scaling2 at 1.3 (CN-4 runaway-stat ceiling, gen path)", () => {
  // A high scaling2 would give runaway high-level stats; generation must honor the
  // same 1.3 ceiling CN-4 enforces on the hand-authored data (its regression test).
  const mt = normalizeGeneratedMonster({ strengthScaling2: 2.7, healthScaling2: 2.0, speedScaling2: 1.3 }, {});
  assert.equal(mt.strengthScaling2, 1.3, "2.7 → capped to 1.3");
  assert.equal(mt.healthScaling2, 1.3, "2.0 → capped to 1.3");
  assert.equal(mt.speedScaling2, 1.3, "1.3 stays 1.3 (at the ceiling)");
});

test("normalizeGeneratedMonster de-duplicates names against the existing pool", () => {
  const existingNames = new Set(["Cinder Wisp", "Cinder Wisp 2"]);
  const mt = normalizeGeneratedMonster({ typeName: "Cinder Wisp" }, { existingNames });
  assert.equal(mt.typeName, "Cinder Wisp 3");
});

test("assignAttacks picks 4 distinct attacks, preferring the monster's element", () => {
  const pool = [];
  for (let i = 0; i < 5; i++) pool.push({ name: `Fire ${i}`, elementalType: "Fire" });
  for (let i = 0; i < 5; i++) pool.push({ name: `Water ${i}`, elementalType: "Water" });
  const mt = normalizeGeneratedMonster({ typeName: "Blaze", element: "Fire" }, {});
  assignAttacks(mt, pool, makeRng(7).next);
  const chosen = [mt.attack_1, mt.attack_2, mt.attack_3, mt.attack_4];
  assert.equal(new Set(chosen).size, 4, "4 distinct attacks");
  assert.ok(chosen.every((n) => n.startsWith("Fire ")), "all same-element when enough exist");
});

test("assignAttacks handles a small/empty pool gracefully", () => {
  const mt = normalizeGeneratedMonster({ typeName: "X", element: "Fire" }, {});
  assignAttacks(mt, [{ name: "Only", elementalType: "Water" }], makeRng(1).next);
  assert.equal(mt.attack_1, "Only");
  assert.equal(mt.attack_2, null);
  const mt2 = normalizeGeneratedMonster({ typeName: "Y" }, {});
  assignAttacks(mt2, [], makeRng(1).next);
  assert.equal(mt2.attack_1, null);
});

test("pickReuseOrGenerate forces generation on an empty pool", () => {
  assert.equal(pickReuseOrGenerate(0, makeRng(1).next), "generate");
  assert.equal(pickReuseOrGenerate(50, () => 0.99, 90), "generate"); // above the reuse threshold
  assert.equal(pickReuseOrGenerate(50, () => 0.0, 90), "reuse");
});

test("pickReuseOrGenerate reuses ~90% on a populated pool", () => {
  const rng = makeRng(12345);
  let reuse = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) if (pickReuseOrGenerate(100, rng.next, 90) === "reuse") reuse++;
  const pct = (reuse / N) * 100;
  assert.ok(pct > 85 && pct < 95, `~90% reuse, got ${pct.toFixed(1)}%`);
});

test("normalizeGeneratedMonster trims long lore/effects on a clean boundary (no mid-word chop)", () => {
  const sentence = "It stalks the ashen wastes and feeds on cinders. ";
  const longDesc = sentence.repeat(20); // ~960 chars, well over the 600 cap
  const longEffect = "Burns every foe in range for several turns and ".repeat(10); // > 240
  const mt = normalizeGeneratedMonster({ typeName: "Ashmaw", description: longDesc, passiveEffect: longEffect }, {});
  assert.ok(mt.description.length <= 600, "description within cap");
  assert.ok(mt.passiveEffect.length <= 243, "passive within cap + ellipsis");
  // The description cap lands inside a repeated sentence whose end (". ") sits in the
  // back of the window, so it should end cleanly on punctuation, no ellipsis.
  assert.ok(/[.!?]$/.test(mt.description), `description ends cleanly: ${JSON.stringify(mt.description.slice(-20))}`);
  // No field chops a word: each ends with either sentence punctuation or "..." (never a bare partial token).
  for (const v of [mt.description, mt.passiveEffect]) {
    assert.ok(/[.!?]$/.test(v) || v.endsWith("..."), `clean end: ${JSON.stringify(v.slice(-12))}`);
  }
});

test("normalizeGeneratedMonster: short lore is untouched", () => {
  const mt = normalizeGeneratedMonster({ typeName: "Wisp", description: "A small spark.", passiveEffect: "Glows." }, {});
  assert.equal(mt.description, "A small spark.");
  assert.equal(mt.passiveEffect, "Glows.");
});
