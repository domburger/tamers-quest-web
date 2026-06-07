import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData } from "./gamedata.js";
import { generateMap, MAP_SIZE, biomeSpeedMultAt } from "./mapgen.js";
import { GAME } from "./schemas.js";

// Load the real game data from disk (the engine is fetch-free; the loader feeds it).
function loadData() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"),
    attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"),
    items: read("item.json"),
  });
}

test("biomeSpeedMultAt reads the biome speedMult under a world point; safe defaults", () => {
  const E = GAME.EFFECTIVE_TILE;
  const map = { biomeMap: [[{ name: "Swamp", speedMult: 0.72 }, null], [null, { name: "Plains", speedMult: 1.15 }]] };
  assert.equal(biomeSpeedMultAt(map, 0, 0), 0.72);            // tile (0,0)
  assert.equal(biomeSpeedMultAt(map, E + 1, E + 1), 1.15);    // tile (1,1)
  assert.equal(biomeSpeedMultAt(map, 0, E + 1), 1);           // null biome → 1
  assert.equal(biomeSpeedMultAt({}, 0, 0), 1);                // no biomeMap → 1
  assert.equal(biomeSpeedMultAt(map, 99999, 99999), 1);       // out of bounds → 1
});

// Full 400x400 generation runs twice per test (~1.6s each) — acceptable, and it
// guards a property the whole multiplayer model relies on, so it runs by default.

test("same seed reproduces an identical map (multiplayer determinism)", async () => {
  loadData();
  const a = await generateMap(null, 4242);
  const b = await generateMap(null, 4242);

  assert.equal(a.seed, 4242);
  assert.equal(a.mapSize, MAP_SIZE);
  assert.deepEqual(a.voidMap, b.voidMap, "voidMap diverged");
  assert.deepEqual(a.monsters, b.monsters, "monster spawns diverged");
  // Biome assignment + tile rotations should match too (spot-check a row).
  const sig = (m) => m.tileMap[200].map((t) => (t ? `${t.name}:${t.rotation}` : "_")).join(",");
  assert.equal(sig(a), sig(b), "tile placement diverged");
});

test("different seeds produce different maps", async () => {
  loadData();
  const a = await generateMap(null, 1);
  const b = await generateMap(null, 2);
  assert.notDeepEqual(a.voidMap, b.voidMap);
});

// GP-1/GP-2: rarity-by-location — edges (where new players spawn) skew to catchable
// low-rarity; the center (shrinking-storm endgame) skews to rare. Guards the early-game
// playability fix so a future spawn refactor can't silently reintroduce the rarity wall.
test("monster rarity is biased low at the edges and high toward the center", async () => {
  loadData();
  const rarityOf = new Map(
    JSON.parse(readFileSync("./public/assets/data/monstertype.json", "utf8"))
      .map((m) => [m.typeName, m.rarity]),
  );
  const m = await generateMap(null, 777);
  const c = (MAP_SIZE - 1) / 2, maxD = Math.hypot(c, c);
  const edge = [], center = [];
  for (const mon of m.monsters) {
    const d = Math.hypot(mon.tileX - c, mon.tileY - c) / maxD;
    const r = rarityOf.get(mon.typeName);
    if (r == null) continue;
    if (d > 0.65) edge.push(r);
    else if (d < 0.35) center.push(r);
  }
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(edge.length > 20 && center.length > 20, "enough samples in both bands");
  assert.ok(avg(edge) < avg(center) - 0.3,
    `edge avg rarity (${avg(edge).toFixed(2)}) should be clearly below center (${avg(center).toFixed(2)})`);
});
