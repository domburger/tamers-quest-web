import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData } from "./gamedata.js";
import { generateMap, MAP_SIZE, biomeSpeedMultAt, biomeNameAt, biomeTintAt, findSpreadSpawns } from "./mapgen.js";
import { makeRng } from "./rng.js";
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

test("biomeSpeedMultAt: exact at biome interior, smoothly interpolated across boundaries (PT1-T22)", () => {
  const E = GAME.EFFECTIVE_TILE;
  // 10×10 map split by a vertical biome boundary at x=5: left half slow, right fast.
  const N = 10;
  const slow = { name: "Water", speedMult: 0.7 }, fast = { name: "Plains", speedMult: 1.1 };
  const biomeMap = Array.from({ length: N }, (_, x) =>
    Array.from({ length: N }, () => (x < 5 ? slow : fast)));
  const map = { biomeMap };
  const center = (i) => (i + 0.5) * E; // world px at the center of tile i

  // Deep inside a uniform biome → the tile's exact value (no bleed from far tiles).
  assert.equal(biomeSpeedMultAt(map, center(1), center(1)), 0.7);
  assert.equal(biomeSpeedMultAt(map, center(8), center(8)), 1.1);

  // Exactly on the slow↔fast boundary (x = 5·E) → the midpoint, not a hard step.
  const mid = biomeSpeedMultAt(map, 5 * E, center(1));
  assert.ok(Math.abs(mid - 0.9) < 1e-9, `boundary should be the 0.7↔1.1 midpoint, got ${mid}`);

  // Monotonic ramp crossing the boundary (no snap): 4 → boundary → 5 strictly rises.
  const a = biomeSpeedMultAt(map, center(4), center(1)); // 0.7 (interior slow)
  const c = biomeSpeedMultAt(map, center(5), center(1)); // 1.1 (interior fast)
  assert.ok(a < mid && mid < c, `expected ${a} < ${mid} < ${c}`);

  // Safe default: no biomeMap → 1 (used while the map is still loading).
  assert.equal(biomeSpeedMultAt({}, 0, 0), 1);
  assert.equal(biomeSpeedMultAt(null, 0, 0), 1);
});

test("biomeNameAt: names the biome at a world position; clamps OOB; null without a map/name", () => {
  const E = GAME.EFFECTIVE_TILE, N = 10;
  const slow = { name: "Water", speedMult: 0.7 }, fast = { name: "Plains", speedMult: 1.1 };
  const biomeMap = Array.from({ length: N }, (_, x) => Array.from({ length: N }, () => (x < 5 ? slow : fast)));
  const map = { biomeMap };
  const center = (i) => (i + 0.5) * E;

  assert.equal(biomeNameAt(map, center(1), center(1)), "Water", "left half");
  assert.equal(biomeNameAt(map, center(8), center(8)), "Plains", "right half");
  // out-of-bounds world coords clamp to the edge tile (never read OOB → undefined crash)
  assert.equal(biomeNameAt(map, -9999, -9999), "Water", "negative clamps to tile 0");
  assert.equal(biomeNameAt(map, 9999 * E, 9999 * E), "Plains", "far clamps to the last tile (right half)");
  // safe defaults (used while the map is still loading)
  assert.equal(biomeNameAt({}, 0, 0), null, "no biomeMap → null");
  assert.equal(biomeNameAt(null, 0, 0), null);
  assert.equal(biomeNameAt({ biomeMap: [[{ speedMult: 1 }]] }, 0, 0), null, "a cell with no name → null");
});

test("biomeTintAt: returns the cell's tint by TILE coords; null without a map/tint/cell/OOB", () => {
  const map = { biomeMap: [
    [{ tint: [10, 20, 30] }, { tint: [40, 50, 60] }],
    [{ name: "X" }, null],
  ] };
  assert.deepEqual(biomeTintAt(map, 0, 0), [10, 20, 30]);
  assert.deepEqual(biomeTintAt(map, 0, 1), [40, 50, 60]);
  assert.equal(biomeTintAt(map, 1, 0), null, "cell present but no tint → null");
  assert.equal(biomeTintAt(map, 1, 1), null, "null cell → null");
  assert.equal(biomeTintAt(map, 9, 9), null, "out-of-bounds tile → null (no crash)");
  assert.equal(biomeTintAt({}, 0, 0), null, "no biomeMap → null");
  assert.equal(biomeTintAt(null, 0, 0), null);
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

// PT1-T17: a playtester reported "large empty unreachable areas." Investigation
// (flood-fill over generated maps, 7 seeds) found the walkable graph is ALWAYS a
// single connected component — the DLA carve attaches every committed walk to the
// existing blob, and the smoothing passes only ADD cells, so it can't strand a
// region. So no flood-fill "connectivity pass" is needed (it would be a no-op); the
// reported emptiness is void-region perception/density (PT1-T11), not reachability.
// This test LOCKS IN the connectivity invariant so a future change (e.g. PT1-T19
// making water impassable) can't silently strand part of the map.
function walkableComponentSizes(voidMap) {
  const N = voidMap.length;
  const seen = Array.from({ length: N }, () => new Array(N).fill(false));
  const sizes = [];
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      if (!voidMap[x][y] || seen[x][y]) continue;
      let size = 0;
      const stack = [[x, y]];
      seen[x][y] = true;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        size++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && nx < N && ny >= 0 && ny < N && voidMap[nx][ny] && !seen[nx][ny]) {
            seen[nx][ny] = true;
            stack.push([nx, ny]);
          }
        }
      }
      sizes.push(size);
    }
  }
  return sizes.sort((a, b) => b - a);
}

test("generated map is fully connected — no stranded/unreachable walkable regions (PT1-T17)", async () => {
  loadData();
  for (const seed of [1, 12345]) {
    const m = await generateMap(null, seed);
    const sizes = walkableComponentSizes(m.voidMap);
    assert.equal(sizes.length, 1,
      `seed ${seed}: walkable area split into ${sizes.length} components ` +
      `(top sizes ${sizes.slice(0, 5).join(",")}) — every region must be reachable`);
    // And every monster must spawn on a walkable tile (so it's reachable + catchable).
    for (const mon of m.monsters) {
      assert.ok(m.voidMap[mon.tileX]?.[mon.tileY],
        `seed ${seed}: monster ${mon.typeName} spawned on a non-walkable tile (${mon.tileX},${mon.tileY})`);
    }
  }
});

test("findSpreadSpawns keeps player spawns apart (GP-5)", () => {
  const N = MAP_SIZE;
  const voidMap = Array.from({ length: N }, () => new Array(N).fill(true)); // fully walkable
  const spawns = findSpreadSpawns(voidMap, makeRng(99), 16, 24);
  assert.equal(spawns.length, 16, "one spawn per player");
  let minD = Infinity;
  for (let i = 0; i < spawns.length; i++)
    for (let j = i + 1; j < spawns.length; j++)
      minD = Math.min(minD, Math.hypot(spawns[i].x - spawns[j].x, spawns[i].y - spawns[j].y));
  assert.ok(minD >= 24, `closest pair (${minD.toFixed(1)} tiles) should be >= 24 apart`);
});
