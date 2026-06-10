import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeGeneratedTile, aiGenerateTile, buildTileDesignerPrompt, buildTileInspirationPrompt } from "./genTiles.js";
import { DEFAULT_PROMPTS, setPrompts } from "./prompts.js";

test("normalizeGeneratedTile: expands one colour into the full colorProfile_* set + flags", () => {
  const t = normalizeGeneratedTile(
    { name: "Glowing Moss", description: "Soft luminous moss over damp stone.", color: { r: 40, g: 120, b: 70 }, emissiveness: 3, collidable: 1, slipperiness: 6, rarity: 25 },
    { id: 99, biome: "Fungal Hollow" },
  );
  assert.equal(t.id, 99);
  assert.equal(t.name, "Glowing Moss");
  assert.equal(t.biome, "Fungal Hollow", "opts.biome wins (so the tile pools correctly)");
  // full colour set from the single colour
  assert.deepEqual([t.colorProfile_full_r, t.colorProfile_full_g, t.colorProfile_full_b], [40, 120, 70]);
  // each side defaults to the full colour (seamless same-type tiling)
  for (const k of ["top", "bottom", "left", "right"])
    assert.deepEqual([t[`colorProfile_${k}_r`], t[`colorProfile_${k}_g`], t[`colorProfile_${k}_b`]], [40, 120, 70], `${k} side = full`);
  assert.equal(t.collidable, 1);
  assert.equal(t.emissiveness, 3);
  assert.equal(t.slipperiness, 6);
  assert.equal(t.rarity, 25);
  assert.equal(t.generated, true, "tagged generated (so an admin wipe spares the seed)");
  assert.equal(t.speedModifier, 1, "movement speed uniform");
});

test("normalizeGeneratedTile: clamps colours/flags and defaults a missing tile", () => {
  const t = normalizeGeneratedTile({ color: [999, -5, "x"], collidable: "nope", rarity: 9999 }, {});
  assert.deepEqual([t.colorProfile_full_r, t.colorProfile_full_g, t.colorProfile_full_b], [255, 0, 102], "RGB clamped (b falls back to default 102)");
  assert.equal(t.collidable, 0, "unparseable collidable → 0");
  assert.equal(t.rarity, 100, "rarity clamped to 100");
  assert.equal(t.name, "Cracked Ground", "missing name → default");
  // alt colour field names + array form are accepted
  assert.deepEqual(
    [normalizeGeneratedTile({ fill: { red: 10, green: 20, blue: 30 } }).colorProfile_full_r,
     normalizeGeneratedTile({ fill: { red: 10, green: 20, blue: 30 } }).colorProfile_full_g], [10, 20]);
});

test("normalizeGeneratedTile: name is made unique vs existingNames", () => {
  const existing = new Set(["Ash", "Ash 2"]);
  assert.equal(normalizeGeneratedTile({ name: "Ash" }, { existingNames: existing }).name, "Ash 3");
});

test("aiGenerateTile: inspiration -> designer -> normalized tile (mocked chat)", async () => {
  const origKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key"; // aiEnabled()
  const calls = [];
  const chat = async (system, user) => {
    calls.push({ system, user });
    return calls.length === 1
      ? { inspiration: "cracked obsidian slab" }                                   // stage 1
      : { name: "Obsidian Slab", description: "Black volcanic glass underfoot.", color: { r: 28, g: 24, b: 32 } }; // stage 2
  };
  try {
    const t = await aiGenerateTile({ id: 7, biome: "Volcano" }, { chat });
    assert.equal(calls.length, 2, "two stages: inspiration then designer");
    assert.ok(calls[0].user.includes("Volcano"), "inspiration prompt carries the biome");
    assert.ok(calls[1].user.includes("cracked obsidian slab"), "designer received the inspiration");
    assert.equal(t.name, "Obsidian Slab");
    assert.equal(t.biome, "Volcano");
    assert.equal(t.id, 7);
    assert.deepEqual([t.colorProfile_full_r, t.colorProfile_full_g, t.colorProfile_full_b], [28, 24, 32]);
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
  }
});

test("aiGenerateTile: returns null when AI is disabled (no key)", async () => {
  const origKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try { assert.equal(await aiGenerateTile(), null); }
  finally { if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey; }
});

test("tile prompts: inspiration carries biome + kind; designer survives an override dropping its slots", async () => {
  const idea = (DEFAULT_PROMPTS.tileIdeaSystem + " " + DEFAULT_PROMPTS.tileIdeaUser).toLowerCase();
  assert.ok(idea.includes("2-4 words"));
  assert.ok(DEFAULT_PROMPTS.tileIdeaUser.includes("{biome}") && DEFAULT_PROMPTS.tileIdeaUser.includes("{kind}"));
  // the inspiration prompt fills both the biome and the kind slots
  const insp = buildTileInspirationPrompt("Tundra", "frozen crust").user;
  assert.ok(insp.includes("Tundra") && insp.includes("frozen crust"));
  // an override that drops {inspiration}+{biome} must still receive both (append-if-missing)
  await setPrompts({ tileDesignerUser: "Design a floor tile as JSON." });
  try {
    const out = buildTileDesignerPrompt("cracked obsidian slab", "Volcano").user;
    assert.ok(out.includes("Design a floor tile"), "override text used");
    assert.ok(out.includes("cracked obsidian slab"), "inspiration appended despite missing slot");
    assert.ok(out.includes("Volcano"), "biome appended despite missing slot");
  } finally {
    await setPrompts({ tileDesignerUser: "" }); // reset to default
  }
});
