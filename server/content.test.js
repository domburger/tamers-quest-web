import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes, addMonsterType, removeMonsterType, getAttacksForMonster } from "../src/engine/gamedata.js";
import { generateMonster } from "./content.js";

// A fake LangChain chat: withStructuredOutput(schema,{name}).invoke() → canned structured
// output keyed by the stage name. Mirrors genStages.test.js's mockChat — monster generation
// is ALWAYS the v2 multi-agent pipeline (the v1 single-call path was removed 2026-06-09).
function mockChat(canned) {
  return {
    withStructuredOutput(_schema, cfg) {
      return { invoke: async () => canned[cfg && cfg.name] };
    },
  };
}

function loadData() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"), attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"), items: read("item.json"),
  });
}

test("monster pool has a low-rarity floor with usable attacks (GP-1/CN-2)", () => {
  loadData();
  const pool = getMonsterTypes();
  const byR = (r) => pool.filter((m) => m.rarity === r);
  // The rarity wall fix: early spawns need real R1/R2 variety (pool had 0×R1, 1×R2).
  assert.ok(byR(1).length >= 5, `expected ≥5 R1 monsters, got ${byR(1).length}`);
  assert.ok(byR(2).length >= 5, `expected ≥5 R2 monsters, got ${byR(2).length}`);
  // Every early-tier monster must have at least one attack that actually resolves
  // (a typo'd / nonexistent attack name → a monster that can't act in combat).
  for (const m of [...byR(1), ...byR(2)]) {
    assert.ok(getAttacksForMonster(m).length >= 1, `${m.typeName} has no usable attack`);
  }
});

test("seed monster elements are canonical — no synonyms or compounds (CN-6)", () => {
  loadData();
  // Merged synonyms (use the canonical form) + malformed dual-element compounds.
  const DEPRECATED = new Set(["Shadow", "Darkness", "Wind", "Holy"]);
  for (const m of getMonsterTypes()) {
    const e = m.element || "";
    assert.ok(!DEPRECATED.has(e), `${m.typeName} uses deprecated element "${e}" (should be canonical)`);
    assert.ok(!e.includes("/"), `${m.typeName} has a compound element "${e}" (pick one)`);
  }
});

test("no monster has a runaway scaling exponent (CN-4)", () => {
  loadData();
  const STATS = ["health", "strength", "defense", "speed", "power", "energy", "luck"];
  const CAP = 1.3; // scaling2 is the exponent in base + s1*level^s2; >1.3 → explosive growth
  for (const m of getMonsterTypes()) {
    for (const s of STATS) {
      const v = m[`${s}Scaling2`];
      if (v == null) continue;
      assert.ok(v <= CAP, `${m.typeName} ${s}Scaling2=${v} exceeds ${CAP} (runaway)`);
    }
  }
});

test("addMonsterType appends new types and dedupes by name", () => {
  loadData();
  const before = getMonsterTypes().length;
  assert.equal(addMonsterType({ typeName: "Zzz Test Beast", element: "Fire" }), true);
  assert.equal(getMonsterTypes().length, before + 1);
  assert.equal(addMonsterType({ typeName: "Zzz Test Beast" }), false, "duplicate name rejected");
  assert.equal(addMonsterType(null), false);
});

test("removeMonsterType drops a type from the pool", () => {
  loadData();
  addMonsterType({ typeName: "Temp Zzz Mon", element: "Fire" });
  const before = getMonsterTypes().length;
  assert.equal(removeMonsterType("Temp Zzz Mon"), true);
  assert.equal(getMonsterTypes().length, before - 1);
  assert.equal(removeMonsterType("No Such Mon"), false);
});

test("generateMonster adds a generated monster to the live pool (mocked v2 pipeline, no DB)", async () => {
  loadData();
  const origKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key"; // aiEnabled() gate for the v2 pipeline
  const canned = {
    MonsterIdea: { inspiration: "tidal armored eel", vibe: "cold and relentless", role: "bruiser", elementHint: "Water", rarityHint: 3 },
    MonsterAttributes: {
      typeName: "Gen Test Beast", element: "Water", rarity: 3, size: 3, description: "A test eel.",
      baseHealth: 80, baseStrength: 60, baseDefense: 50, baseSpeed: 70, basePower: 65, baseEnergy: 75, baseLuck: 40,
      healthScaling1: 1.1, healthScaling2: 0.9,
      attacks: [
        { title: "Tide Lash", description: "Whips with a torrent for Water damage." },
        { title: "Brine Spit", description: "Spits brine; may lower the foe's defense." },
        { title: "Undertow", description: "Drags the foe under, sapping its energy." },
        { title: "Crush Coil", description: "Constricts for heavy physical damage." },
      ],
    },
  };
  try {
    const before = getMonsterTypes().length;
    // deps.createChat injects the mock LangChain client → no live spend; the pipeline runs
    // Idea→Attributes and assigns attacks from the pool loaded by loadData().
    const mt = await generateMonster({}, { createChat: () => mockChat(canned) });
    assert.ok(mt, "returns a monster");
    assert.equal(mt.typeName, "Gen Test Beast");
    assert.equal(mt.element, "Water");
    assert.ok(mt.attack_1, "attacks assigned from the pool");
    assert.equal(mt.genAttacks.length, 4, "AI-authored genAttacks carried onto the monster");
    assert.equal(getMonsterTypes().length, before + 1);
    assert.ok(getMonsterTypes().some((m) => m.typeName === "Gen Test Beast"), "added to the pool");
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
  }
});
