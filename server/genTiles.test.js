import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeGeneratedTile, aiGenerateTile, buildTileDesignerPrompt, buildTileInspirationPrompt } from "./genTiles.js";
import { DEFAULT_PROMPTS, setPrompts } from "./prompts.js";
import { setAiConfig } from "./aiconfig.js";

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
  assert.equal(t.emissiveness, 3, "emissiveness ON by default (TQ-361)");
  assert.equal(t.slipperiness, 0, "slipperiness OFF by default → forced to 0 (TQ-361)");
  assert.equal(t.rarity, 25);
  assert.equal(t.generated, true, "tagged generated (so an admin wipe spares the seed)");
  assert.equal(t.speedModifier, 1, "movement speed uniform (speed modifier OFF)");
});

test("TQ-361: tile-modifier toggles gate slipperiness / speed / emissiveness generation", async () => {
  // Defaults: slipperiness OFF → 0, speed OFF → uniform 1, emissiveness ON → keeps the value.
  let t = normalizeGeneratedTile({ slipperiness: 8, speedModifier: 1.5, emissiveness: 4 }, {});
  assert.equal(t.slipperiness, 0, "slipperiness off by default");
  assert.equal(t.speedModifier, 1, "speed off by default → uniform 1");
  assert.equal(t.emissiveness, 4, "emissiveness on by default");
  try {
    await setAiConfig({ tileSlipperinessEnabled: true, tileSpeedModifierEnabled: true, tileEmissivenessEnabled: false });
    t = normalizeGeneratedTile({ slipperiness: 8, speedModifier: 1.5, emissiveness: 4 }, {});
    assert.equal(t.slipperiness, 8, "enabled → slipperiness generated");
    assert.equal(t.speedModifier, 1.5, "enabled → per-tile speed generated");
    assert.equal(t.emissiveness, 0, "disabled → emissiveness forced to 0");
  } finally {
    // reset shared aiconfig state so other suites see the defaults
    await setAiConfig({ tileSlipperinessEnabled: false, tileSpeedModifierEnabled: false, tileEmissivenessEnabled: true });
  }
});

test("TQ-148: distinct per-edge colours from the designer map into colorProfile_{side} (richer WFC tiling)", () => {
  const t = normalizeGeneratedTile(
    { color: { r: 80, g: 80, b: 80 },
      top: { r: 96, g: 96, b: 96 }, bottom: { r: 64, g: 64, b: 64 },
      left: { r: 84, g: 84, b: 84 }, right: { r: 76, g: 76, b: 76 } },
    { id: 5, biome: "Stone" },
  );
  assert.deepEqual([t.colorProfile_full_r, t.colorProfile_full_g, t.colorProfile_full_b], [80, 80, 80], "base colour unchanged");
  assert.deepEqual([t.colorProfile_top_r, t.colorProfile_top_g, t.colorProfile_top_b], [96, 96, 96], "top edge from the designer");
  assert.deepEqual([t.colorProfile_bottom_r, t.colorProfile_bottom_g, t.colorProfile_bottom_b], [64, 64, 64], "bottom edge from the designer");
  assert.deepEqual([t.colorProfile_left_r, t.colorProfile_left_g, t.colorProfile_left_b], [84, 84, 84], "left edge from the designer");
  assert.deepEqual([t.colorProfile_right_r, t.colorProfile_right_g, t.colorProfile_right_b], [76, 76, 76], "right edge from the designer");
  // The four edges genuinely differ → WFC seam-matching + rotation now have something to vary on
  // (the old behaviour forced all four edges to the base colour, making rotation a no-op).
  assert.ok(new Set([t.colorProfile_top_r, t.colorProfile_bottom_r, t.colorProfile_left_r, t.colorProfile_right_r]).size > 1,
    "edges are not all identical");
});

test("TQ-148: a partially-supplied edge ({side}Color alias) maps; the rest default to base (backward compat)", () => {
  const t = normalizeGeneratedTile({ color: { r: 10, g: 10, b: 10 }, topColor: { r: 30, g: 30, b: 30 } }, {});
  assert.deepEqual([t.colorProfile_top_r, t.colorProfile_top_g, t.colorProfile_top_b], [30, 30, 30], "topColor alias maps to the top edge");
  assert.deepEqual([t.colorProfile_bottom_r, t.colorProfile_bottom_g, t.colorProfile_bottom_b], [10, 10, 10], "unspecified edge defaults to the base colour");
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

test("aiGenerateTile: inspiration -> designer -> builder -> normalized tile (mocked chat)", async () => {
  const origKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key"; // aiEnabled()
  const calls = [];
  const chat = async (system, user) => {
    calls.push({ system, user });
    if (calls.length === 1) return { inspiration: "cracked obsidian slab" };                                        // stage 1
    if (calls.length === 2) return { name: "Obsidian Slab", description: "Black volcanic glass underfoot.", color: { r: 28, g: 24, b: 32 } }; // stage 2 (designer: no visual)
    return { html: `<div style="position:relative;width:256px;height:256px;background:#1c181f"><div style="position:absolute;left:20px;top:30px;width:40px;height:3px;background:#0e0c12"></div></div>` }; // stage 3: builder authors free HTML/CSS (TQ-393)
  };
  try {
    const t = await aiGenerateTile({ id: 7, biome: "Volcano" }, { chat });
    assert.equal(calls.length, 3, "three stages: inspiration, designer, builder (TQ-372)");
    assert.ok(calls[0].user.includes("Volcano"), "inspiration prompt carries the biome");
    assert.ok(calls[1].user.includes("cracked obsidian slab"), "designer received the inspiration");
    assert.ok(calls[2].user.includes("Obsidian Slab"), "builder received the DESIGNED tile (name)");
    assert.equal(t.name, "Obsidian Slab");
    assert.equal(t.biome, "Volcano");
    assert.equal(t.id, 7);
    assert.deepEqual([t.colorProfile_full_r, t.colorProfile_full_g, t.colorProfile_full_b], [28, 24, 32]);
    assert.ok(t.html && typeof t.html.base === "string" && /<div/i.test(t.html.base), "builder's HTML texture is attached (TQ-393)");
    assert.equal(t.html.canvas, 256, "html model carries the canonical 256 canvas");
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
  }
});

test("TQ-372: aiGenerateTile skips the Builder when tileBuilderEnabled is off (no visual, one fewer call)", async () => {
  const origKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  const calls = [];
  const chat = async (system, user) => {
    calls.push({ system, user });
    if (calls.length === 1) return { inspiration: "ashen dust" };
    return { name: "Ash Dust", color: { r: 60, g: 56, b: 52 } };
  };
  try {
    await setAiConfig({ tileBuilderEnabled: false });
    const t = await aiGenerateTile({ biome: "Wastes" }, { chat });
    assert.equal(calls.length, 2, "builder OFF → only inspiration + designer run");
    assert.equal(t.html, undefined, "no authored html → renderer falls back to procedural grain");
    assert.equal(t.name, "Ash Dust");
  } finally {
    await setAiConfig({ tileBuilderEnabled: true }); // reset shared aiconfig for other suites
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
