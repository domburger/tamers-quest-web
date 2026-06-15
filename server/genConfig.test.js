// TQ-364: round-composition + generation config registry. No DB in tests, so loadGenConfig/
// saveGenConfig are no-ops ({} / undefined) and we exercise the pure defaults/override/derive logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initGenConfig, getGenConfig, allGenConfig, setGenConfig, roundComposition, DEFAULT_GEN_CONFIG } from "./genConfig.js";

test("TQ-364: defaults match Dominik's spec (12 biomes, 16/biome, 4+8 tiles, 30 new/round)", async () => {
  await initGenConfig();
  assert.equal(getGenConfig("biomesPerRound"), 12);
  assert.equal(getGenConfig("newBiomesPerRound"), 1);
  assert.equal(getGenConfig("monstersPerBiome"), 16);
  assert.equal(getGenConfig("tilesCollidablePerBiome"), 4);
  assert.equal(getGenConfig("tilesNonCollidablePerBiome"), 8);
  assert.equal(getGenConfig("maxNewMonstersPerRound"), 30);
});

test("TQ-364: roundComposition derives reused = total - new and tiles/biome = collidable + walkable", async () => {
  await initGenConfig();
  const c = roundComposition();
  assert.equal(c.reusedBiomesPerRound, 11); // 12 - 1
  assert.equal(c.tilesPerBiome, 12);        // 4 + 8
  assert.equal(c.biomesPerRound, 12);
});

test("TQ-364: setGenConfig validates + clamps; derived reused stays coherent", async () => {
  await initGenConfig();
  await setGenConfig({ biomesPerRound: 8, newBiomesPerRound: 3, monstersPerBiome: 999, tilesCollidablePerBiome: -5 });
  assert.equal(getGenConfig("biomesPerRound"), 8);
  assert.equal(getGenConfig("newBiomesPerRound"), 3);
  assert.equal(getGenConfig("monstersPerBiome"), 64);       // clamped to max
  assert.equal(getGenConfig("tilesCollidablePerBiome"), 0); // clamped to min
  const c = roundComposition();
  assert.equal(c.reusedBiomesPerRound, 5); // 8 - 3
});

test("TQ-364: new biomes never exceed the total (fresh clamped to total in the plan)", async () => {
  await initGenConfig();
  await setGenConfig({ biomesPerRound: 4, newBiomesPerRound: 10 });
  const c = roundComposition();
  assert.equal(c.newBiomesPerRound, 4);     // clamped to total
  assert.equal(c.reusedBiomesPerRound, 0);  // 4 - 4, floored at 0
});

test("TQ-364: empty/null value resets a key to its default", async () => {
  await initGenConfig();
  await setGenConfig({ biomesPerRound: 20 });
  assert.equal(getGenConfig("biomesPerRound"), 20);
  await setGenConfig({ biomesPerRound: "" });
  assert.equal(getGenConfig("biomesPerRound"), DEFAULT_GEN_CONFIG.biomesPerRound);
});

test("TQ-364: allGenConfig reports current/default/overridden + the composition", async () => {
  await initGenConfig();
  await setGenConfig({ monstersPerBiome: 20 });
  const all = allGenConfig();
  assert.equal(all.fields.monstersPerBiome.current, 20);
  assert.equal(all.fields.monstersPerBiome.default, 16);
  assert.equal(all.fields.monstersPerBiome.overridden, true);
  assert.equal(all.fields.biomesPerRound.overridden, false);
  assert.ok(all.composition && typeof all.composition.tilesPerBiome === "number");
});
