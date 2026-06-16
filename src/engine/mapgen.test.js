import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData } from "./gamedata.js";
import { generateMap, MAP_SIZE, BIOME_DEFS, allBiomes, setAiOnlyBiomes, buildBiomePools, buildBiomeMonsterPools, diverseMonsterPool, biomeNameAt, biomeTintAt, isWalkable, edgeClearX, edgeClearY, findSpawnPoint, findSpreadSpawns, largestWalkableComponent } from "./mapgen.js";
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

test("setAiOnlyBiomes: drops the built-in BIOME_DEFS from the pool (with a never-empty safety net)", () => {
  try {
    // With generated biomes present, AI-only excludes every built-in.
    setGameData({ biomes: [{ name: "Gen Mire", rarity: 40, size: 60, tint: [10, 40, 30] }] });
    setAiOnlyBiomes(true);
    let pool = allBiomes();
    assert.deepEqual(pool.map((b) => b.name), ["Gen Mire"], "AI-only → generated biomes only, no built-ins");
    assert.ok(!pool.some((b) => BIOME_DEFS.find((d) => d.name === b.name)), "no built-in biome leaks through");
    // Safety net: with NO generated biomes, fall back to BIOME_DEFS so map gen never gets zero biomes.
    setGameData({ biomes: [] });
    pool = allBiomes();
    assert.equal(pool.length, BIOME_DEFS.length, "empty generated pool → falls back to built-ins (never zero)");
    // Toggle off → built-ins return.
    setAiOnlyBiomes(false);
    assert.ok(allBiomes().length >= BIOME_DEFS.length, "AI-only off → built-ins included again");
  } finally {
    setAiOnlyBiomes(false);
    setGameData({ biomes: [] });
  }
});

test("TQ-441: a zero ground-tile pool falls back to DEFAULT_TILES (no all-void map)", async () => {
  try {
    loadData();
    setGameData({ groundTiles: [] }); // AI-content-only prod with 0 generated tiles
    const map = await generateMap(null, 4242);
    let nonNull = 0; const names = new Set();
    for (let x = 0; x < MAP_SIZE; x++) for (let y = 0; y < MAP_SIZE; y++) {
      const t = map.tileMap[x][y];
      if (t) { nonNull++; names.add(t.name); }
    }
    assert.ok(nonNull > 0, "zero-tile pool must NOT produce an all-void map (safety net active)");
    assert.ok([...names].some((n) => String(n).startsWith("default-")), "map uses the DEFAULT_TILES fallback set");
  } finally {
    loadData(); // restore the seed tiles for the rest of the suite
  }
});

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

test("isWalkable (TQ-360): tile.collidable-driven — non-collidable walkable; collidable / no-tile / OOB blocked", () => {
  const E = GAME.EFFECTIVE_TILE;
  // TQ-360: every cell carries a tile and walkability is the tile's collidable flag ALONE (voidMap is
  // kept as the DLA source but isWalkable no longer consults it — former-void cells are collidable=1).
  const map = {
    tileMap: [[{ collidable: false }, { collidable: true }], [null, { collidable: true }]],
  };
  const at = (tx, ty) => isWalkable(map, (tx + 0.5) * E, (ty + 0.5) * E);
  assert.equal(at(0, 0), true, "present non-collidable tile → walkable floor");
  assert.equal(at(0, 1), false, "collidable tile (e.g. water) → blocked");
  assert.equal(at(1, 0), false, "no tile (still loading gap) → blocked (no invisible wall)");
  assert.equal(at(1, 1), false, "collidable boundary tile (former void) → blocked");
  assert.equal(isWalkable(map, -5, -5), false, "OOB negative → blocked");
  assert.equal(isWalkable(null, 0, 0), true, "no map (still loading) → walkable");
});

test("edgeClearX/Y (TQ-499): slide-safe leading-edge corner guard — no corner-poke, no false-block", () => {
  const E = GAME.EFFECTIVE_TILE, R = GAME.PLAYER_RADIUS;
  // 5×5 walkable floor wrapped as a real map ({tileMap}); override specific cells to collidable walls.
  const floor = () => ({ tileMap: Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ collidable: false }))) });
  // Exact mirror of the SHARED per-axis resolution (onlineGame prediction + world.js player/monster):
  // x first (its result feeds the y check), full leading-edge clearance on each axis.
  const move = (map, x, y, dx, dy) => {
    let rx = x, ry = y;
    const nx = x + dx, ny = y + dy;
    if (dx !== 0 && edgeClearX(map, nx + Math.sign(dx) * R, y, R)) rx = nx;
    if (dy !== 0 && edgeClearY(map, rx, ny + Math.sign(dy) * R, R)) ry = ny;
    return { x: rx, y: ry };
  };
  // True if any part of the body footprint (4 box CORNERS + 4 edge midpoints, radius R) sits inside a
  // wall — i.e. the sprite would visibly overlap the wall ("glitching into walls").
  const bodyPokes = (map, x, y) => !(
    isWalkable(map, x + R, y) && isWalkable(map, x - R, y) && isWalkable(map, x, y + R) && isWalkable(map, x, y - R) &&
    isWalkable(map, x + R, y + R) && isWalkable(map, x + R, y - R) && isWalkable(map, x - R, y + R) && isWalkable(map, x - R, y - R));

  // (A) Corner-poke closed: a lone wall at tile (2,2); approach RIGHT at a y whose body BOTTOM (y+R)
  // straddles the wall row. The midpoint probe (at y) never enters the wall, so the OLD single-point
  // rule slid the body's bottom-right corner into (2,2); the edge guard must stop short.
  const wall = floor(); wall.tileMap[2][2] = { collidable: true };
  let p = { x: 100, y: 150 }; // y+R = 163 → wall row (ty 2); y-R = 137 → row 1
  for (let i = 0; i < 40; i++) { p = move(wall, p.x, p.y, 6, 0); assert.equal(bodyPokes(wall, p.x, p.y), false, "body (incl. corners) never overlaps the wall while moving right past it"); }
  assert.ok(p.x > 100, "still advanced right (not over-blocked)");

  // (B) Flat-wall slide preserved: a full vertical wall column at tx=2. Push right into it, then move
  // along Y — the player must still slide (Y advances), proving the guard doesn't snag flat walls.
  const vwall = floor(); for (let ty = 0; ty < 5; ty++) vwall.tileMap[2][ty] = { collidable: true };
  p = { x: 80, y: 200 };
  for (let i = 0; i < 40; i++) p = move(vwall, p.x, p.y, 6, 0); // press against the wall
  assert.ok(p.x + R <= 160 + 0.001 && p.x > 80, "pressed up against the vertical wall");
  const yBefore = p.y;
  for (let i = 0; i < 10; i++) { p = move(vwall, p.x, p.y, 0, 6); assert.equal(bodyPokes(vwall, p.x, p.y), false, "body stays clear while sliding along the wall"); }
  assert.ok(p.y > yBefore, "slid ALONG the flat wall (Y advanced) — not snagged");

  // (C) 1-tile (80px) corridor not blocked: walls at tx=0 and tx=2, walkable corridor at tx=1.
  const corr = floor(); for (let ty = 0; ty < 5; ty++) { corr.tileMap[0][ty] = { collidable: true }; corr.tileMap[2][ty] = { collidable: true }; }
  p = { x: 120, y: 40 }; // centred in the corridor (tile x=1: [80,160))
  const yc = p.y;
  for (let i = 0; i < 30; i++) { p = move(corr, p.x, p.y, 0, 6); assert.equal(bodyPokes(corr, p.x, p.y), false, "body fits the 1-tile corridor"); }
  assert.ok(p.y > yc, "walked freely down the 1-tile corridor (not blocked by the edge guard)");
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

// TQ-367: per-biome tile composition — exactly N collidable + M non-collidable per biome, picked by
// a content key so the server + every client compose IDENTICAL pools (MP determinism for collision).
test("TQ-367: buildBiomePools composes each biome to the collidable/non-collidable split", () => {
  const tiles = [];
  for (let i = 0; i < 6; i++) tiles.push({ biome: "Forest", collidable: 1, rarity: i, name: "c" + i }); // 6 collidable
  for (let i = 0; i < 10; i++) tiles.push({ biome: "Forest", collidable: 0, rarity: i, name: "w" + i }); // 10 walkable
  const pools = buildBiomePools(tiles, { tilesCollidablePerBiome: 4, tilesNonCollidablePerBiome: 8 });
  assert.equal(pools.Forest.filter((t) => t.collidable).length, 4, "collidable capped at 4");
  assert.equal(pools.Forest.filter((t) => !t.collidable).length, 8, "non-collidable capped at 8");
});

test("buildBiomePools uses AI (html) tiles EXCLUSIVELY when a biome has them; simple tiles are fallback", () => {
  // A biome's AI/html tiles are its authored look; the simple built-in/procedural tiles must NOT be
  // mixed in (they'd dominate and the map renders flat). Used exclusively where present, fallback else.
  const html = { base: "<div style='width:100%;height:100%;background:#abc'></div>", canvas: 100 };
  const tiles = [];
  for (let i = 0; i < 10; i++) tiles.push({ biome: "Tundra", collidable: 0, rarity: 10 + i, name: "flat" + i }); // simple/built-in (low rarity)
  tiles.push({ biome: "Tundra", collidable: 0, rarity: 72, name: "Rime Basalt", html }); // AI walkable
  tiles.push({ biome: "Tundra", collidable: 1, rarity: 70, name: "Frost Wall", html }); // AI collidable
  for (let i = 0; i < 5; i++) tiles.push({ biome: "Plains", collidable: 0, rarity: i, name: "grass" + i }); // biome with NO AI tiles
  const pools = buildBiomePools(tiles, { tilesCollidablePerBiome: 4, tilesNonCollidablePerBiome: 8 });
  assert.ok(pools.Tundra.every((t) => t.html), "Tundra composes ONLY its AI/html tiles (the 10 simple flats are excluded)");
  assert.equal(pools.Tundra.length, 2, "exactly the 2 AI tiles (1 walkable + 1 collidable)");
  assert.ok(pools.Plains.every((t) => !t.html), "Plains has no AI tiles → falls back to the simple pool");
  assert.equal(pools.Plains.filter((t) => !t.collidable).length, 5, "all 5 simple walkable kept (fallback)");
});

test("TQ-367: a biome short of either kind keeps what it has (no fabrication)", () => {
  const tiles = [
    { biome: "Cave", collidable: 1, rarity: 1, name: "rock" },           // only 1 collidable
    { biome: "Cave", collidable: 0, rarity: 1, name: "floor" },
    { biome: "Cave", collidable: 0, rarity: 2, name: "moss" },
  ];
  const pools = buildBiomePools(tiles, { tilesCollidablePerBiome: 4, tilesNonCollidablePerBiome: 8 });
  assert.equal(pools.Cave.filter((t) => t.collidable).length, 1);
  assert.equal(pools.Cave.filter((t) => !t.collidable).length, 2);
});

test("TQ-367: composition is order-independent (same picks regardless of input order)", () => {
  const mk = (n, r) => ({ biome: "B", collidable: 0, rarity: r, name: n });
  const a = buildBiomePools([mk("a", 3), mk("b", 1), mk("c", 2)], { tilesCollidablePerBiome: 0, tilesNonCollidablePerBiome: 2 });
  const b = buildBiomePools([mk("c", 2), mk("a", 3), mk("b", 1)], { tilesCollidablePerBiome: 0, tilesNonCollidablePerBiome: 2 });
  assert.deepEqual(a.B.map((t) => t.name), b.B.map((t) => t.name), "picked tiles must not depend on pool order");
});

test("TQ-367: no comp → full per-biome pools (back-compat)", () => {
  const pools = buildBiomePools([{ biome: "A", collidable: 1, rarity: 1, name: "x" }, { biome: "A", collidable: 0, rarity: 2, name: "y" }]);
  assert.equal(pools.A.length, 2);
});

// TQ-360: the whole map is tiles — the former "void" becomes collidable=1 boundary tiles, walkable
// cells stay collidable=0; walkability is driven by tile.collidable alone (equivalent to the old
// voidMap+!collidable rule), and the boundary fill is deterministic so server + client agree.
test("TQ-360: every in-grid cell is a tile; every former-void cell is a collidable boundary", async () => {
  loadData();
  const m = await generateMap(null, 24601);
  let nulls = 0, voidWalkable = 0, voidCells = 0;
  for (let x = 0; x < m.mapSize; x++) for (let y = 0; y < m.mapSize; y++) {
    const t = m.tileMap[x][y];
    if (t == null) { nulls++; continue; }
    if (!m.voidMap[x][y]) { voidCells++; if (!t.collidable) voidWalkable++; } // former-void must be impassable
  }
  assert.equal(nulls, 0, "no empty cell — the whole map is tiles (no abyss within the grid)");
  assert.ok(voidCells > 0, "the map has a former-void region");
  assert.equal(voidWalkable, 0, "every former-void cell is collidable=1 (impassable boundary)");
});

test("TQ-360: isWalkable is tile.collidable-driven and the boundary fill is deterministic", async () => {
  loadData();
  const E = GAME.EFFECTIVE_TILE;
  const a = await generateMap(null, 778899);
  const b = await generateMap(null, 778899);
  let checkedFloor = false, checkedWall = false, mism = 0;
  for (let x = 0; x < a.mapSize; x++) for (let y = 0; y < a.mapSize; y++) {
    const ta = a.tileMap[x][y], tb = b.tileMap[x][y];
    // Determinism: same seed → identical collidability everywhere (server vs client MP-sync contract).
    if (!!(ta && ta.collidable) !== !!(tb && tb.collidable)) mism++;
    const wx = x * E + E / 2, wy = y * E + E / 2;
    if (ta && !ta.collidable) { assert.equal(isWalkable(a, wx, wy), true); checkedFloor = true; }
    else if (ta && ta.collidable) { assert.equal(isWalkable(a, wx, wy), false); checkedWall = true; }
  }
  assert.equal(mism, 0, "same seed → identical collidable pattern (MP determinism)");
  assert.ok(checkedFloor && checkedWall, "exercised both a walkable floor and a collidable boundary cell");
});

// TQ-366: per-biome monster pools of N, diversity-maximized + biome-matched-first, deterministic.
test("TQ-366: diverseMonsterPool spreads across rarity buckets (round-robin) + caps at n", () => {
  const mk = (name, rarity) => ({ typeName: name, rarity });
  const cands = [mk("a", 1), mk("b", 1), mk("c", 1), mk("d", 5), mk("e", 5), mk("f", 5)];
  const pool = diverseMonsterPool(cands, 4);
  assert.equal(pool.length, 4);
  assert.equal(pool.filter((m) => m.rarity === 1).length, 2, "round-robin → even rarity spread, not 3+1");
  assert.equal(pool.filter((m) => m.rarity === 5).length, 2);
});

test("TQ-366: diverseMonsterPool dedupes by typeName", () => {
  const dup = { typeName: "x", rarity: 2 };
  const pool = diverseMonsterPool([dup, dup, { typeName: "y", rarity: 2 }], 5);
  assert.equal(pool.length, 2);
});

test("TQ-366: buildBiomeMonsterPools yields monstersPerBiome, biome-matched first, order-independent", () => {
  const mk = (name, biome, rarity) => ({ typeName: name, biome, rarity });
  const mons = [mk("forestA", "Forest", 2), mk("forestB", "Forest", 4), mk("desertA", "Desert", 2), mk("none1", null, 3), mk("none2", null, 5)];
  const a = buildBiomeMonsterPools(mons, { monstersPerBiome: 3 }, ["Forest"]);
  assert.equal(a.Forest.length, 3);
  assert.ok(a.Forest.some((m) => m.typeName === "forestA"), "biome-matched monster included");
  assert.ok(a.Forest.some((m) => m.typeName === "forestB"), "biome-matched monster included");
  const shuffled = [mons[4], mons[2], mons[0], mons[3], mons[1]];
  const b = buildBiomeMonsterPools(shuffled, { monstersPerBiome: 3 }, ["Forest"]);
  assert.deepEqual(a.Forest.map((m) => m.typeName).sort(), b.Forest.map((m) => m.typeName).sort(), "pool must not depend on input order");
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
