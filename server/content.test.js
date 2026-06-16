import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes, addMonsterType, removeMonsterType, getAttacksForMonster, getBiomes } from "../src/engine/gamedata.js";
import { BIOME_DEFS } from "../src/engine/mapgen.js";
import { generateMonster, itemDiversitySeed, tileDiversitySeed, neediestTileTarget, saveGeneratedMonster, genInFlightState } from "./content.js";

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
    // Stage-3 Model/builder runs by default (aiconfig.genModel ON). TQ-259: it now authors the
    // creature FROM SCRATCH as free-form HTML/CSS markup per state (was SVG).
    MonsterModel: { canvas: 256, base: '<div style="width:256px;height:256px;background:#16324a"><span style="background:#7fe0ff"></span></div>' },
  };
  try {
    const before = getMonsterTypes().length;
    // deps.createChat injects the mock LangChain client → no live spend; the pipeline runs
    // Idea→Attributes→Model and assigns attacks from the pool loaded by loadData().
    const mt = await generateMonster({}, { createChat: () => mockChat(canned) });
    assert.ok(mt, "returns a monster");
    assert.equal(mt.typeName, "Gen Test Beast");
    assert.ok(mt.attack_1, "attacks assigned from the pool");
    assert.equal(mt.genAttacks.length, 4, "AI-authored genAttacks carried onto the monster");
    assert.ok(mt.html && mt.html.base.includes("<div"), "builder authored HTML model attached");
    assert.ok(mt.html.base.includes("background"), "coerced HTML keeps the inline-styled markup");
    assert.equal(getMonsterTypes().length, before + 1);
    assert.ok(getMonsterTypes().some((m) => m.typeName === "Gen Test Beast"), "added to the pool");
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
  }
});

test("TQ-213: generateMonster dryRun returns the generated monster WITHOUT adding it to the live pool", async () => {
  loadData();
  const origKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  const canned = {
    MonsterIdea: { inspiration: "ash wyrm", vibe: "smouldering", role: "bruiser", elementHint: "Fire", rarityHint: 2 },
    MonsterAttributes: {
      typeName: "Gen DryRun Beast", element: "Fire", rarity: 2, size: 2, description: "A dry-run test wyrm.",
      baseHealth: 70, baseStrength: 55, baseDefense: 45, baseSpeed: 60, basePower: 60, baseEnergy: 65, baseLuck: 35,
      healthScaling1: 1.1, healthScaling2: 0.9,
      attacks: [
        { title: "Ash Bite", description: "Bites with smouldering jaws for Fire damage." },
        { title: "Cinder Spit", description: "Spits cinders; may burn the foe." },
        { title: "Tail Sweep", description: "Sweeps the tail for physical damage." },
        { title: "Ember Coil", description: "Coils and sears the foe." },
      ],
    },
    MonsterModel: { canvas: 256, base: '<div style="width:256px;height:256px;background:#4a2016"></div>' },
  };
  try {
    const before = getMonsterTypes().length;
    const mt = await generateMonster({ dryRun: true }, { createChat: () => mockChat(canned) });
    assert.ok(mt, "returns the generated monster");
    assert.equal(mt.typeName, "Gen DryRun Beast");
    assert.ok(mt.html && mt.html.base.includes("<div"), "carries the authored HTML model for preview");
    assert.equal(getMonsterTypes().length, before, "live pool unchanged — dry run did NOT save");
    assert.ok(!getMonsterTypes().some((m) => m.typeName === "Gen DryRun Beast"), "not added to the live pool");
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
  }
});

test("TQ-216: saveGeneratedMonster persists a previewed monster to the live pool (and rejects a dup)", async () => {
  loadData();
  const before = getMonsterTypes().length;
  const mt = { typeName: "Zzz Save Test Beast", element: "Fire", rarity: 1 };
  assert.equal(await saveGeneratedMonster(mt), true, "saved");
  assert.equal(getMonsterTypes().length, before + 1);
  assert.ok(getMonsterTypes().some((m) => m.typeName === "Zzz Save Test Beast"), "added to the live pool");
  assert.equal(await saveGeneratedMonster(mt), false, "duplicate name is not re-added");
  assert.equal(getMonsterTypes().length, before + 1, "pool unchanged after the duplicate save");
});

test("itemDiversitySeed: a no-kind roll tags the item with structured category/rarity/effect (TQ-64)", () => {
  const seed = itemDiversitySeed({});
  assert.equal(typeof seed.kind, "string", "picks a prompt string for the AI");
  assert.ok(seed._meta, "carries a structured _meta tag");
  assert.equal(seed._meta.category, "consumable");
  assert.ok(["common", "uncommon", "rare", "epic", "legendary"].includes(seed._meta.rarity), "rarity is a valid tier");
  assert.ok(seed._meta.effect && typeof seed._meta.effect.kind === "string", "effect has a kind");
  assert.ok(["self", "enemy"].includes(seed._meta.effect.target), "effect targets self or enemy");
  // An explicit string kind (admin override) is respected and gets NO structured tag.
  const explicit = itemDiversitySeed({ kind: "a custom item" });
  assert.equal(explicit.kind, "a custom item");
  assert.equal(explicit._meta, undefined, "explicit kind is left untagged");
});

test("TQ-150: tileDiversitySeed always targets a LIVE biome (so a generated tile pools as a distinct region)", () => {
  const live = new Set([...BIOME_DEFS.map((b) => b.name), ...getBiomes().map((b) => b.name)]);
  // With no biome, a real live biome is chosen — never the normalizer's orphan "Wilds" (which matches
  // no live biome → the all-tiles WFC fallback, so the region has no distinct ground). Loop to cover
  // the random pick. This + TQ-83's connectivity confinement are the safety guarantees this Story locks.
  for (let i = 0; i < 25; i++) {
    const seed = tileDiversitySeed({});
    assert.ok(live.has(seed.biome), `picked a live biome (got "${seed.biome}")`);
    assert.notEqual(seed.biome, "Wilds", "never the orphan default");
    assert.equal(typeof seed.kind, "string", "also picks a surface kind for variety");
  }
  // An explicit biome (the batch tool iterating the live pool, or an admin picker) is respected verbatim.
  const explicit = tileDiversitySeed({ biome: "Volcano", kind: "obsidian shard" });
  assert.equal(explicit.biome, "Volcano");
  assert.equal(explicit.kind, "obsidian shard");
});

test("tileDiversitySeed: kind is split by collidability (solid surface vs walkable floor)", () => {
  const SOLID = /water|lava|wall|chasm|spires|ice|tar/i;
  for (let i = 0; i < 20; i++) {
    assert.ok(SOLID.test(tileDiversitySeed({ biome: "X", collidable: 1 }).kind), "collidable → a solid/boundary surface kind");
    assert.ok(!SOLID.test(tileDiversitySeed({ biome: "X", collidable: 0 }).kind), "walkable → an open-floor kind");
  }
  assert.equal(tileDiversitySeed({ biome: "X", collidable: 1, kind: "preset" }).kind, "preset", "an explicit kind is respected");
});

// The tile balancer: of all biomes, pick the (biome, collidability) slot furthest below its target so
// repeated generation fills every biome's collidable + walkable quota evenly (not random/skewed).
test("neediestTileTarget: fills the most-deficient (biome, collidability) slot first", () => {
  const biomes = ["A", "B"];
  const targets = { collidable: 4, walk: 8 };
  // A is empty; B already has its 4 collidable. The biggest shortfalls are the two walk slots (8 each);
  // rand()=0 takes the first candidate in biome+type order → A, walkable.
  assert.deepEqual(
    neediestTileTarget(biomes, { B: { collidable: 4, walk: 0 } }, targets, {}, () => 0),
    { biome: "A", collidable: 0 });
  // Pin collidable=1 → the biome most short of COLLIDABLE: A (0/4) over B (4/4).
  assert.deepEqual(
    neediestTileTarget(biomes, { B: { collidable: 4, walk: 0 } }, targets, { collidable: 1 }, () => 0),
    { biome: "A", collidable: 1 });
  // Pin biome=B → B's neediest type: walk (0/8) over collidable (4/4).
  assert.deepEqual(
    neediestTileTarget(biomes, { B: { collidable: 4, walk: 0 } }, targets, { biome: "B" }, () => 0),
    { biome: "B", collidable: 0 });
});

test("neediestTileTarget: all quotas met → still returns a valid (biome, collidable) slot", () => {
  const r = neediestTileTarget(["A"], { A: { collidable: 4, walk: 8 } }, { collidable: 4, walk: 8 }, {}, () => 0);
  assert.equal(r.biome, "A");
  assert.ok(r.collidable === 0 || r.collidable === 1);
});

test("TQ-317: genInFlightState reports the active gen (type) and clears on success AND failure", async () => {
  loadData();
  const origKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  const canned = {
    MonsterIdea: { inspiration: "in-flight test", vibe: "test", role: "bruiser", elementHint: "Water", rarityHint: 1 },
    MonsterAttributes: {
      typeName: "InFlight Probe", element: "Water", rarity: 1, size: 1, description: "probe.",
      baseHealth: 60, baseStrength: 50, baseDefense: 50, baseSpeed: 50, basePower: 50, baseEnergy: 60, baseLuck: 30,
      healthScaling1: 1, healthScaling2: 1,
      attacks: [{ title: "A", description: "a." }, { title: "B", description: "b." }, { title: "C", description: "c." }, { title: "D", description: "d." }],
    },
    MonsterModel: { canvas: 256, base: '<div style="width:256px;height:256px;background:#123"></div>' },
  };
  try {
    assert.equal(genInFlightState().active, false, "idle before any gen");
    // Start a gen but DON'T await yet — the synchronous prologue sets the in-flight state.
    const p = generateMonster({}, { createChat: () => mockChat(canned) });
    assert.equal(genInFlightState().active, true, "active mid-flight");
    assert.equal(genInFlightState().type, "monster", "type tracked");
    assert.ok(genInFlightState().startedAt > 0, "startedAt set");
    await p;
    assert.equal(genInFlightState().active, false, "cleared after success");

    // Failure path: a chat whose invoke throws → the gen fails, but the flag must STILL clear (finally).
    const boom = { withStructuredOutput: () => ({ invoke: async () => { throw new Error("boom"); } }) };
    const r = await generateMonster({}, { createChat: () => boom }).catch(() => null);
    assert.equal(r, null);
    assert.equal(genInFlightState().active, false, "cleared after failure (no phantom in-progress)");
  } finally {
    removeMonsterType("InFlight Probe");
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
  }
});
