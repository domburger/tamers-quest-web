import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData } from "./gamedata.js";
import { generateMap, MAP_SIZE, BIOME_DEFS, biomeNameAt, biomeTintAt, isWalkable, findSpawnPoint, findSpreadSpawns, largestWalkableComponent } from "./mapgen.js";
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

// (biomeSpeedMultAt removed 2026-06-09: biomes no longer modify movement speed, so
// there is no per-biome speed field or interpolation left to test.)

test("biomeNameAt: names the biome at a world position; clamps OOB; null without a map/name", () => {
  const E = GAME.EFFECTIVE_TILE, N = 10;
  const left = { name: "Water" }, right = { name: "Plains" };
  const biomeMap = Array.from({ length: N }, (_, x) => Array.from({ length: N }, () => (x < 5 ? left : right)));
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
  assert.equal(biomeNameAt({ biomeMap: [[{ tint: [1, 2, 3] }]] }, 0, 0), null, "a cell with no name → null");
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

test("findSpawnPoint: picks an open cell (3×3 walkable); falls back gracefully, never OOB/crash", () => {
  const grid = (fill) => Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => fill));

  // All walkable → an interior cell whose full 3×3 neighbourhood is walkable.
  const open = grid(true);
  const p = findSpawnPoint(open, makeRng(5));
  assert.ok(p.x >= 1 && p.x <= MAP_SIZE - 2 && p.y >= 1 && p.y <= MAP_SIZE - 2, "interior cell");
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) assert.ok(open[p.x + dx][p.y + dy], "3×3 all walkable");

  // Only an isolated single walkable cell → no valid 3×3 → fall back to the first walkable cell.
  const isolated = grid(false); isolated[1][1] = true;
  assert.deepEqual(findSpawnPoint(isolated, makeRng(5)), { x: 1, y: 1 });

  // All void → final fallback is the map centre (never returns OOB / throws).
  assert.deepEqual(findSpawnPoint(grid(false), makeRng(5)), { x: MAP_SIZE / 2, y: MAP_SIZE / 2 });
});

test("findSpawnPoint/findSpreadSpawns avoid collidable tiles when a tileMap is supplied (TQ-82)", () => {
  const grid = (fill) => Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => fill));
  const open = grid(true); // every cell has 3×3 clearance
  // All tiles are collidable water EXCEPT one walkable cell — the only valid spawn.
  const tileMap = Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => ({ collidable: true })));
  tileMap[10][10] = { collidable: false };
  // Random attempts land on collidable cells and are rejected; the fallback scan finds the one
  // effectively-walkable cell rather than returning a collidable one.
  assert.deepEqual(findSpawnPoint(open, makeRng(5), tileMap), { x: 10, y: 10 });
  // findSpreadSpawns threads the tileMap through, so every spawn is non-collidable.
  const spawns = findSpreadSpawns(open, makeRng(7), 4, 24, tileMap);
  for (const s of spawns) assert.equal(tileMap[s.x][s.y].collidable, false, "spawn is not on a collidable tile");
});

test("largestWalkableComponent: returns the biggest EFFECTIVELY-walkable component, splitting on collidable (TQ-83)", () => {
  // 5×5 all-carved; a collidable column at x=1 splits the floor into x=0 (5 cells) and x=2..4
  // (15 cells). The largest reachable component is the right side only.
  const N = 5;
  const voidMap = Array.from({ length: N }, () => new Array(N).fill(true));
  const tileMap = Array.from({ length: N }, (_, x) => Array.from({ length: N }, () => ({ collidable: x === 1 })));
  const reach = largestWalkableComponent(voidMap, tileMap);
  let count = 0;
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (reach[x][y]) count++;
  assert.equal(count, 15, "only the larger (x>=2) component is marked");
  assert.equal(reach[0][0], false, "the small isolated pocket (x=0) is excluded");
  assert.equal(reach[1][0], false, "the collidable barrier itself is not walkable");
  for (let x = 2; x < N; x++) for (let y = 0; y < N; y++) assert.equal(reach[x][y], true, "the large component is fully marked");
  // No tileMap → all carved cells count (voidMap is a single component).
  const all = largestWalkableComponent(voidMap);
  let allCount = 0;
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (all[x][y]) allCount++;
  assert.equal(allCount, N * N, "without collidable info the whole carved area is one component");
});

test("isWalkable: floor cell with a non-collidable tile walkable; void / no-tile / collidable / OOB not", () => {
  const E = GAME.EFFECTIVE_TILE;
  const map = {
    voidMap: [[true, true], [true, false]],
    tileMap: [[{ collidable: false }, { collidable: true }], [null, { collidable: false }]],
  };
  const at = (tx, ty) => isWalkable(map, (tx + 0.5) * E, (ty + 0.5) * E);
  assert.equal(at(0, 0), true, "void + present non-collidable tile → walkable");
  assert.equal(at(0, 1), false, "collidable tile (e.g. water) → blocked even on void floor");
  assert.equal(at(1, 0), false, "void floor but no tile → blocked (no invisible wall)");
  assert.equal(at(1, 1), false, "not a void floor cell → blocked");
  assert.equal(isWalkable(map, -5, -5), false, "OOB negative → blocked");
  assert.equal(isWalkable(null, 0, 0), true, "no map (still loading) → walkable");
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

// TQ-365: when the round supplies an explicit biome SET, the map uses EXACTLY that set (one Voronoi
// centre per biome, so all appear) and stays deterministic for the same seed+set — the contract that
// lets the server hand a 12-biome set to every client and have their regenerated maps match.
test("TQ-365: an explicit biome set is deterministic and every set biome appears (none leak in)", async () => {
  loadData();
  const set = BIOME_DEFS.slice(0, 12);
  const a = await generateMap(null, 9090, set);
  const b = await generateMap(null, 9090, set);
  const sig = (m) => m.biomeMap.map((col) => col.map((c) => (c ? c.name : "_")).join("")).join("");
  assert.equal(sig(a), sig(b), "biome assignment diverged for the same seed + set");
  const present = new Set();
  for (let x = 0; x < MAP_SIZE; x++) for (let y = 0; y < MAP_SIZE; y++) { const c = a.biomeMap[x][y]; if (c) present.add(c.name); }
  for (const b2 of set) assert.ok(present.has(b2.name), `set biome ${b2.name} missing from the map`);
  for (const n of present) assert.ok(set.some((b2) => b2.name === n), `unexpected biome ${n} leaked into the map`);
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

test("empty monster pool → a valid, monster-less map (no types[-1] crash)", async () => {
  // Repro of the prod hazard: the hand-authored seed is suppressed (AI-only) and the DB pool
  // is empty/unreachable (or a map generates before initContent merges it), so getMonsterTypes()
  // is []. spawnMonsters must yield a monster-less but valid map, never deref an undefined type.
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({ monsterTypes: [], attacks: read("attacks.json"), groundTiles: read("groundtiles.json"), items: read("item.json") });
  const m = await generateMap(null, 1234);
  assert.ok(m && Array.isArray(m.monsters), "map generated without throwing");
  assert.equal(m.monsters.length, 0, "no monsters spawned from an empty pool");
  assert.equal(m.mapSize, MAP_SIZE, "map is otherwise valid/playable");
  loadData(); // restore the populated pool for later tests
});

test("generated map is fully connected — no stranded/unreachable walkable regions (PT1-T17)", async () => {
  loadData();
  for (const seed of [1, 12345]) {
    const m = await generateMap(null, seed);
    const sizes = walkableComponentSizes(m.voidMap);
    assert.equal(sizes.length, 1,
      `seed ${seed}: walkable area split into ${sizes.length} components ` +
      `(top sizes ${sizes.slice(0, 5).join(",")}) — every region must be reachable`);
    // And every monster must spawn on a walkable tile (so it's reachable + catchable) —
    // including a non-COLLIDABLE one (TQ-82: never on water).
    for (const mon of m.monsters) {
      assert.ok(m.voidMap[mon.tileX]?.[mon.tileY],
        `seed ${seed}: monster ${mon.typeName} spawned on a non-walkable tile (${mon.tileX},${mon.tileY})`);
      assert.ok(!m.tileMap[mon.tileX]?.[mon.tileY]?.collidable,
        `seed ${seed}: monster ${mon.typeName} spawned on a collidable tile (${mon.tileX},${mon.tileY})`);
      // TQ-83: and within the largest reachable component, so every monster is mutually reachable.
      assert.ok(m.reachMap?.[mon.tileX]?.[mon.tileY],
        `seed ${seed}: monster ${mon.typeName} spawned outside the largest reachable component (${mon.tileX},${mon.tileY})`);
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
