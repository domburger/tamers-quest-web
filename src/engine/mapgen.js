import { getGroundTiles, getMonsterTypes, getBiomes } from "./gamedata.js";
import { getMonsterStats } from "./stats.js";
import { makeRng, randomSeed } from "./rng.js";
import { GAME } from "./schemas.js";

export const MAP_SIZE = 400;
const WALKABLE_PERCENTAGE = 0.35;
const SHORT_WALK_STEPS = 500;
const MAX_DLA_STEPS = 500;
const NUM_BIOMES = 10;
const SMOOTHING_PASSES = 3;
const MONSTER_DENSITY = 0.005;

// Biomes are PURELY VISUAL/region markers now. Movement is the SAME speed
// everywhere — the old per-biome `speedMult` (terrain that sped you up / dragged
// you down) was removed 2026-06-09 (user: "remove movement speed modifiers from
// tiles and biomes"). Biome assignment stays seeded + deterministic.
//
// `tint` (PT1-T07) is a representative RGB per biome so the minimap reads as
// REAL, distinguishable biome regions (forest=green, desert=sand, water=blue, …)
// instead of the muddy per-tile averages that all looked "green". Static +
// deterministic, so SP and MP minimaps can blend it in identically.
export const BIOME_DEFS = [
  { name: "Forest", rarity: 30, size: 80, tint: [60, 120, 64] },
  { name: "Plains", rarity: 40, size: 60, tint: [150, 168, 82] },
  { name: "Desert", rarity: 40, size: 60, tint: [202, 178, 110] },
  { name: "Tundra", rarity: 50, size: 80, tint: [198, 214, 230] },
  { name: "Volcano", rarity: 70, size: 60, tint: [192, 78, 50] },
  { name: "Swamp", rarity: 40, size: 60, tint: [86, 108, 68] },
  { name: "Metal", rarity: 70, size: 60, tint: [142, 152, 166] },
  { name: "Stone", rarity: 30, size: 60, tint: [128, 128, 134] },
  { name: "Mushroom", rarity: 70, size: 40, tint: [172, 98, 168] },
  { name: "Astral", rarity: 90, size: 40, tint: [138, 110, 222] },
  { name: "Water", rarity: 90, size: 80, tint: [58, 120, 210] },
  { name: "Crystal", rarity: 60, size: 50, tint: [104, 206, 210] },
];

// TQ-441: never-empty TILE safety net (parity with the zero-biome net added in TQ-438). AI-content-only
// prod loads no seed tiles (groundTiles = []), so a DB with ZERO generated tiles would otherwise leave
// every map cell null → an all-void, unplayable round. When getGroundTiles() is empty, generateMap falls
// back to this tiny default set so the floor is always playable until generated tiles exist. It is a
// shared module const (server + every client import the same values), and only kicks in when BOTH sides
// have zero tiles — so the server and client regenerate the IDENTICAL map for a seed (MP-determinism is
// preserved). Plain procedural tiles (no `html`) → tiles.js paints the base colour + grain. Negative ids
// can't collide with real (positive) DB tile ids. biome:"" means they're used via the global allTiles
// fallback path in fillMapWithTiles (no per-biome match needed).
export const DEFAULT_TILES = [
  { id: -901, name: "default-floor-a", biome: "", collidable: 0, rarity: 10, colorProfile_full_r: 78, colorProfile_full_g: 74, colorProfile_full_b: 90 },
  { id: -902, name: "default-floor-b", biome: "", collidable: 0, rarity: 10, colorProfile_full_r: 68, colorProfile_full_g: 66, colorProfile_full_b: 82 },
  { id: -903, name: "default-floor-c", biome: "", collidable: 0, rarity: 10, colorProfile_full_r: 86, colorProfile_full_g: 80, colorProfile_full_b: 96 },
  { id: -904, name: "default-wall", biome: "", collidable: 1, rarity: 10, colorProfile_full_r: 46, colorProfile_full_g: 42, colorProfile_full_b: 56 },
];

/**
 * Representative minimap RGB for the biome under a tile coord, or null. The
 * biomeMap cell IS one of the BIOME_DEFS objects (see generateBiomesVoronoi), so
 * the tint rides along — pure lookup, shared by the SP + MP minimaps.
 * @param {{biomeMap?:Array}} map  a generateMap() result
 * @param {number} tx @param {number} ty  tile coords
 * @returns {?number[]} [r,g,b] or null
 */
export function biomeTintAt(map, tx, ty) {
  return map?.biomeMap?.[tx]?.[ty]?.tint ?? null;
}

/**
 * Is the world-space point (x, y) walkable? TQ-360: walkability is driven by the
 * tile's `collidable` flag ALONE — every cell now carries a tile (collidable=1 =
 * impassable boundary, the former "void"; collidable=0 = walkable floor), so a
 * present non-collidable tile is walkable and everything else (collidable tile, or
 * off-grid where there is no tile) is a wall. Equivalent to the old voidMap+!collidable
 * rule (former-void cells are collidable=1), but expressed purely via the tile.
 * Shared collision rule: the server (tickRound), the SP client, and the MP client's
 * movement prediction all consume this so they agree on where walls are (no
 * "invisible wall" / "walk on water" drift). Null map → walkable (map still loading).
 * @param {{tileMap?:Array}} map  a generateMap() result
 * @param {number} x @param {number} y  world px
 * @returns {boolean}
 */
export function isWalkable(map, x, y) {
  if (!map?.tileMap) return true;
  const E = GAME.EFFECTIVE_TILE;
  const tx = Math.floor(x / E), ty = Math.floor(y / E);
  const tile = map.tileMap?.[tx]?.[ty];
  return !!tile && !tile.collidable;
}

/**
 * Name of the biome under a WORLD-space point, or null (PT1-T18 HUD indicator).
 * Nearest-tile lookup (a label doesn't need the speed field's interpolation).
 * @param {{biomeMap?:Array}} map  a generateMap() result
 * @param {number} worldX @param {number} worldY  world px
 * @returns {?string}
 */
export function biomeNameAt(map, worldX, worldY) {
  const bm = map?.biomeMap;
  if (!bm) return null;
  const E = GAME.EFFECTIVE_TILE;
  const N = bm.length;
  const tx = Math.max(0, Math.min(N - 1, Math.floor(worldX / E)));
  const ty = Math.max(0, Math.min(N - 1, Math.floor(worldY / E)));
  return bm[tx]?.[ty]?.name ?? null;
}

// (biomeSpeedMultAt removed 2026-06-09 — biomes no longer modify movement speed.)

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Generate a map. Pass a `seed` (number or string) to reproduce a map exactly —
// required for multiplayer (server picks the seed, clients regenerate it). When
// omitted, a fresh random seed is used and returned in the result.
// TQ-365: `biomeSet` (optional) is the EXPLICIT, ordered set of biome defs the round is composed of
// — one Voronoi centre per biome, so ALL of them appear in the map. The server picks the set
// (stable, 11 reused + 1 new per round) and delivers the SAME defs to every client in roundStart, so
// the seeded map matches everywhere. Omitted (hub preview / legacy / tests) → the historic
// NUM_BIOMES rarity-weighted pick from the full pool (byte-identical to before).
export async function generateMap(onProgress, seed, biomeSet = null, comp = null) {
  const actualSeed = seed ?? randomSeed();
  const rng = makeRng(actualSeed);

  const voidMap = new Array(MAP_SIZE);
  const biomeMap = new Array(MAP_SIZE);
  const tileMap = new Array(MAP_SIZE);

  for (let x = 0; x < MAP_SIZE; x++) {
    voidMap[x] = new Array(MAP_SIZE).fill(false);
    biomeMap[x] = new Array(MAP_SIZE).fill(null);
    tileMap[x] = new Array(MAP_SIZE).fill(null);
  }

  onProgress?.(0.05, "Carving terrain...");
  await generateDLA(voidMap, onProgress, rng);

  onProgress?.(0.55, "Assigning biomes...");
  generateBiomesVoronoi(biomeMap, rng, biomeSet);

  onProgress?.(0.60, "Selecting tiles...");
  // TQ-441: never-empty safety net — AI-content-only prod with 0 generated tiles must not yield an
  // all-void map. Fall back to the deterministic DEFAULT_TILES const (shared server+client → same map).
  const allTiles = getGroundTiles();
  const tiles = allTiles.length ? allTiles : DEFAULT_TILES;
  const tilesByBiome = buildBiomePools(tiles, comp); // TQ-367: 4 collidable + 8 non-collidable per biome when comp given
  await fillMapWithTiles(voidMap, biomeMap, tileMap, tiles, tilesByBiome, onProgress, rng);
  // TQ-360: the former "void" (off-map area NOT carved by DLA) becomes real tiles — every still-empty
  // in-grid cell gets a collidable=1 boundary tile from its biome, so the world reads as solid terrain
  // with explicit impassable edges instead of an abyss. Deterministic + rng-free (position-hashed), so
  // the server + every client agree AND the monster-spawn rng stream below is left byte-identical.
  fillVoidWithBoundaryTiles(biomeMap, tileMap, tiles);

  onProgress?.(0.95, "Spawning monsters...");
  // TQ-83: confine spawns to the largest EFFECTIVELY-walkable component so every player + monster
  // is mutually reachable (collidable water can split the playable graph even though voidMap isn't).
  const reachMap = largestWalkableComponent(voidMap, tileMap);
  // TQ-366: when the round set its composition, spawn from per-biome diversity-maximized 16-pools.
  let monstersByBiome = null;
  if (comp && comp.monstersPerBiome) {
    const names = (biomeSet && biomeSet.length) ? biomeSet.map((b) => b.name) : distinctBiomeNames(biomeMap);
    monstersByBiome = buildBiomeMonsterPools(getMonsterTypes(), comp, names);
  }
  const monsters = spawnMonsters(voidMap, tileMap, rng, reachMap, biomeMap, monstersByBiome);

  onProgress?.(1.0, "Done!");

  return { voidMap, biomeMap, tileMap, monsters, reachMap, mapSize: MAP_SIZE, seed: actualSeed };
}

function yieldFrame() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function generateDLA(voidMap, onProgress, rng) {
  const requiredTiles = Math.floor(MAP_SIZE * MAP_SIZE * WALKABLE_PERCENTAGE);

  // Initial random walk near center
  const startX = Math.floor(MAP_SIZE / 4 + rng.next() * (MAP_SIZE / 4));
  const startY = Math.floor(MAP_SIZE / 4 + rng.next() * (MAP_SIZE / 4));
  let x = startX;
  let y = startY;

  for (let i = 0; i < SHORT_WALK_STEPS; i++) {
    const dir = rng.range(4);
    if (dir === 0) x = Math.min(x + 1, MAP_SIZE - 1);
    else if (dir === 1) x = Math.max(x - 1, 0);
    else if (dir === 2) y = Math.min(y + 1, MAP_SIZE - 1);
    else y = Math.max(y - 1, 0);
    voidMap[x][y] = true;
  }

  let walkableCount = countWalkable(voidMap);
  let yieldCounter = 0;

  // DLA loop: each walk marks the entire path back to start
  while (walkableCount < requiredTiles) {
    const sx = rng.range(MAP_SIZE);
    const sy = rng.range(MAP_SIZE);
    walkableCount += dlaWalk(voidMap, sx, sy, rng);

    yieldCounter++;
    if (yieldCounter % 500 === 0) {
      onProgress?.(0.05 + 0.45 * Math.min(1, walkableCount / requiredTiles), "Carving terrain...");
      await yieldFrame();
    }
  }

  // Smooth 3 times (matching Java)
  for (let pass = 0; pass < SMOOTHING_PASSES; pass++) {
    smoothMap(voidMap);
    widenNarrowTunnels(voidMap);
  }
}

// Reused across dlaWalk calls. The DLA loop invokes dlaWalk thousands of times per map (until
// WALKABLE_PERCENTAGE of the 160k cells is carved), and each call built a fresh `path` array and grew it
// via push() — thousands of allocations + their internal growth-reallocations per generation. dlaWalk is
// fully synchronous (it never yields mid-walk) and consumes the buffer entirely before returning, so a
// single shared buffer reset to empty at each call is safe and byte-identical.
const _dlaPath = [];
function dlaWalk(voidMap, startX, startY, rng) {
  const path = _dlaPath; path.length = 0;
  let x = startX, y = startY;

  for (let step = 0; step < MAX_DLA_STEPS; step++) {
    path.push(x, y);

    // Check all 4 neighbors (with clamping, matching Java's MathUtils.clamp)
    let foundNeighbor = false;
    for (let d = 0; d < 4; d++) {
      const nx = Math.max(0, Math.min(MAP_SIZE - 1, x + DIRS[d][0]));
      const ny = Math.max(0, Math.min(MAP_SIZE - 1, y + DIRS[d][1]));
      if (voidMap[nx][ny]) {
        foundNeighbor = true;
        break;
      }
    }

    if (foundNeighbor) {
      // Mark ALL positions along the walk path
      let count = 0;
      for (let i = 0; i < path.length; i += 2) {
        const px = path[i], py = path[i + 1];
        if (!voidMap[px][py]) {
          voidMap[px][py] = true;
          count++;
        }
      }
      return count;
    }

    // Random walk with clamping
    const dir = DIRS[rng.range(4)];
    x = Math.max(0, Math.min(MAP_SIZE - 1, x + dir[0]));
    y = Math.max(0, Math.min(MAP_SIZE - 1, y + dir[1]));
  }

  return 0;
}

function countWalkable(voidMap) {
  let count = 0;
  for (let x = 0; x < MAP_SIZE; x++)
    for (let y = 0; y < MAP_SIZE; y++)
      if (voidMap[x][y]) count++;
  return count;
}

// Apply in-place to match Java (modifications during iteration affect subsequent checks)
function smoothMap(voidMap) {
  for (let x = 0; x < MAP_SIZE; x++) {
    for (let y = 0; y < MAP_SIZE; y++) {
      if (voidMap[x][y]) continue;
      let neighbors = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < MAP_SIZE && ny >= 0 && ny < MAP_SIZE && voidMap[nx][ny]) {
            neighbors++;
          }
        }
      }
      if (neighbors > 4) voidMap[x][y] = true;
    }
  }
}

// Apply in-place to match Java
function widenNarrowTunnels(voidMap) {
  for (let x = 1; x < MAP_SIZE - 1; x++) {
    for (let y = 1; y < MAP_SIZE - 1; y++) {
      if (!voidMap[x][y]) continue;
      // Vertical passage (walkable up/down, void left/right) → widen horizontal
      if (!voidMap[x - 1][y] && !voidMap[x + 1][y] && voidMap[x][y - 1] && voidMap[x][y + 1]) {
        voidMap[x - 1][y] = true;
        voidMap[x + 1][y] = true;
      }
      // Horizontal passage (walkable left/right, void up/down) → widen vertical
      if (!voidMap[x][y - 1] && !voidMap[x][y + 1] && voidMap[x - 1][y] && voidMap[x + 1][y]) {
        voidMap[x][y - 1] = true;
        voidMap[x][y + 1] = true;
      }
    }
  }
}

// AI-CONTENT-ONLY toggle (server sets this in prod, mirroring AI_MONSTERS_ONLY): when on, the
// built-in BIOME_DEFS baseline is DROPPED and the world is composed purely from AI-generated biomes.
// A safety net keeps a non-empty pool — if there are no generated biomes yet, BIOME_DEFS is still used
// so map gen never gets zero biomes (a dead round). Server-only; the client keeps BIOME_DEFS as its
// offline fallback (online/SP rounds use the server-provided biomeSet, so this never diverges).
let aiOnlyBiomes = false;
export function setAiOnlyBiomes(v) { aiOnlyBiomes = !!v; }
// Base built-in set, honouring the AI-only toggle (with the never-empty safety net applied by callers).
function builtinBiomes() { return aiOnlyBiomes ? [] : BIOME_DEFS; }

// The biomes the Voronoi region picker draws from: the built-in baseline (unless AI-only) plus any
// AI-GENERATED biomes (engine/gamedata `getBiomes`). Both the server and every client compute the
// SAME list for a given pool — the generated pool is delivered to the client verbatim (server's order)
// via /api/biomes — so the seeded map stays deterministic across them.
function biomeList() {
  const gen = getBiomes();
  const out = gen && gen.length ? [...builtinBiomes(), ...gen] : [...builtinBiomes()];
  return out.length ? out : [...BIOME_DEFS]; // safety net: never zero biomes
}

// TQ-365: the full biome pool (built-ins unless AI-only + generated) as a fresh array — the round-
// formation code (server/world.js) draws its stable, rotating round set from this.
export function allBiomes() {
  const gen = getBiomes();
  const out = gen && gen.length ? [...builtinBiomes(), ...gen] : [...builtinBiomes()];
  return out.length ? out : [...BIOME_DEFS]; // safety net: never zero biomes
}

// TQ-84: pick a biome for a region centre WEIGHTED by rarity so common biomes (low `rarity`)
// dominate and rare ones (Astral/Water at 90) are genuinely uncommon — instead of the old uniform
// rng.pick. Weight = (101 - rarity): rarity 30 → 71, rarity 90 → 11 (≈6.5× likelier). One rng draw
// (same per-centre rng consumption as the old rng.pick, so the downstream stream stays stable).
function pickBiomeByRarity(pool, rng) {
  let total = 0;
  for (const b of pool) total += Math.max(1, 101 - (Number(b.rarity) || 50));
  let r = rng.next() * total;
  for (const b of pool) { r -= Math.max(1, 101 - (Number(b.rarity) || 50)); if (r <= 0) return b; }
  return pool[pool.length - 1];
}

function generateBiomesVoronoi(biomeMap, rng, biomeSet = null) {
  const centers = [];
  if (biomeSet && biomeSet.length) {
    // TQ-365: one centre per biome in the round's set, so every biome in the set appears. Each centre
    // draws the SAME two rng values (x,y) on server + client (identical set order), so placement matches.
    for (const biome of biomeSet) {
      centers.push({ x: rng.range(MAP_SIZE), y: rng.range(MAP_SIZE), biome });
    }
  } else {
    const pool = biomeList();
    const n = Math.min(NUM_BIOMES, pool.length); // clamp: a small generated-only pool must not over-pick
    for (let i = 0; i < n; i++) {
      centers.push({
        x: rng.range(MAP_SIZE),
        y: rng.range(MAP_SIZE),
        biome: pickBiomeByRarity(pool, rng),
      });
    }
  }

  // TQ-84: size-weighted Voronoi — divide the squared distance by the biome's `size` so a larger-size
  // biome claims a proportionally bigger basin (the `size` field was dead before). The weight is invariant
  // across cells, so resolve it ONCE per centre: the nearest-centre loop below runs MAP_SIZE² × centres
  // (160000 × ~10) times, and computing Number(biome.size) inside it repeated the same coercion ~2M times
  // per map. The cached value is byte-identical, so the /sz score — and thus the server/client biome
  // assignment (MP-determinism, TQ-365) — is unchanged.
  for (const c of centers) c.sz = (c.biome && Number(c.biome.size)) || 60;

  for (let x = 0; x < MAP_SIZE; x++) {
    for (let y = 0; y < MAP_SIZE; y++) {
      let best = Infinity;
      let closest = null;
      for (const center of centers) {
        const dx = x - center.x;
        const dy = y - center.y;
        const score = (dx * dx + dy * dy) / center.sz;
        if (score < best) {
          best = score;
          closest = center.biome;
        }
      }
      biomeMap[x][y] = closest;
    }
  }
}

// Group tiles by biome name. TQ-367: when `comp` is given, COMPOSE each biome to exactly
// comp.tilesCollidablePerBiome collidable + comp.tilesNonCollidablePerBiome non-collidable tiles.
// Selection is rng-free + sorted by a CONTENT key (rarity, then name) so the server and every client
// pick the IDENTICAL tiles regardless of pool-delivery order — the same MP-determinism contract the
// biome set (TQ-365) relies on. A biome short of either kind keeps what it has (generation backfill =
// TQ-368). Omitted comp → the full per-biome pool (byte-identical to before).
export function buildBiomePools(allTiles, comp = null) {
  const pools = {};
  for (const tile of allTiles) {
    const b = tile.biome || "unknown";
    if (!pools[b]) pools[b] = [];
    pools[b].push(tile);
  }
  if (!comp) return pools;
  const nC = Math.max(0, comp.tilesCollidablePerBiome | 0);
  const nW = Math.max(0, comp.tilesNonCollidablePerBiome | 0);
  // The AI-GENERATED (html-textured) tiles are a biome's authored look and are used EXCLUSIVELY in any
  // biome that has them; the simple built-in/procedural tiles are only a FALLBACK, for biomes that have
  // no generated tiles yet. (Without this, a biome's built-in flat tiles — typically lower rarity — were
  // mixed in and dominated the composed pool, so the map rendered mostly flat.) Deterministic sort
  // (rarity, then name) so the server and client compose the identical pool for the same seed.
  const hasHtmlTex = (t) => !!(t && t.html && typeof t.html.base === "string" && t.html.base.trim());
  const byContent = (a, b) => (Number(a.rarity || 0) - Number(b.rarity || 0)) || ((a.name || "") < (b.name || "") ? -1 : (a.name || "") > (b.name || "") ? 1 : 0);
  const out = {};
  for (const biome of Object.keys(pools)) {
    const tiles = pools[biome];
    const ai = tiles.filter(hasHtmlTex);
    const source = ai.length ? ai : tiles; // AI tiles exclusive when present, else fall back to the simple pool
    const collide = source.filter((t) => t.collidable).sort(byContent).slice(0, nC);
    const walk = source.filter((t) => !t.collidable).sort(byContent).slice(0, nW);
    out[biome] = [...walk, ...collide];
  }
  return out;
}

async function fillMapWithTiles(voidMap, biomeMap, tileMap, allTiles, tilesByBiome, onProgress, rng) {
  let filled = 0;
  let total = 0;
  for (let x = 0; x < MAP_SIZE; x++)
    for (let y = 0; y < MAP_SIZE; y++)
      if (voidMap[x][y]) total++;

  for (let x = 0; x < MAP_SIZE; x++) {
    for (let y = 0; y < MAP_SIZE; y++) {
      if (!voidMap[x][y]) continue;

      const biomeName = biomeMap[x][y]?.name || "";
      const biomePool = tilesByBiome[biomeName];
      const biomeMatched = biomePool && biomePool.length > 0;
      const candidates = biomeMatched ? biomePool : allTiles;

      // Already-placed neighbours. Their OVERALL colour is what we match against (TQ-407: the per-side
      // edge-colour concept was removed, so there is no rotation-by-seam step any more — full colour is
      // rotation-invariant). Raster order fills left + above first; right/below are read too for symmetry.
      const leftN = x > 0 ? tileMap[x - 1][y] : null;
      const rightN = x < MAP_SIZE - 1 ? tileMap[x + 1][y] : null;
      const aboveN = y > 0 ? tileMap[x][y - 1] : null;
      const belowN = y < MAP_SIZE - 1 ? tileMap[x][y + 1] : null;

      let bestTile = null;
      let bestScore = -Infinity;

      for (const tile of candidates) {
        const fR = tile.colorProfile_full_r, fG = tile.colorProfile_full_g, fB = tile.colorProfile_full_b;
        // Biome bonus + a per-candidate jitter (one rng.next() per candidate, as before — so the
        // later monster-spawn rng stream is consumed identically), then prefer neighbours whose
        // overall colour is close so the floor reads as a smooth, coherent ground.
        let score = (biomeMatched ? 50 : 0) + rng.next() * 16;
        if (leftN) score += compareFullFast(fR, fG, fB, leftN.colorProfile_full_r, leftN.colorProfile_full_g, leftN.colorProfile_full_b);
        if (rightN) score += compareFullFast(fR, fG, fB, rightN.colorProfile_full_r, rightN.colorProfile_full_g, rightN.colorProfile_full_b);
        if (aboveN) score += compareFullFast(fR, fG, fB, aboveN.colorProfile_full_r, aboveN.colorProfile_full_g, aboveN.colorProfile_full_b);
        if (belowN) score += compareFullFast(fR, fG, fB, belowN.colorProfile_full_r, belowN.colorProfile_full_g, belowN.colorProfile_full_b);

        if (score > bestScore) {
          bestScore = score;
          bestTile = tile;
        }
      }

      if (bestTile) {
        // Deterministic position-hash rotation (TQ-407): keeps the per-type grain/texture from reading
        // as a uniform repeating stamp now that rotation is no longer chosen by edge seam-matching.
        // rng-free (position-hashed), so it's identical on server + every client and leaves the
        // monster-spawn rng stream untouched.
        tileMap[x][y] = {
          ...bestTile,
          rotation: (hashXY(x, y) % 4) * 90,
          activeMonster: null,
        };
      }

      filled++;
      if (filled % 2000 === 0) {
        onProgress?.(0.60 + 0.35 * (filled / total), "Placing tiles...");
        await yieldFrame();
      }
    }
  }
}

// TQ-360: assign every still-empty (former-void) cell a collidable=1 boundary tile from its biome, so
// the whole map is tiles — collidable=1 = impassable boundary, collidable=0 = walkable. PURE +
// DETERMINISTIC: picks by a position hash from the biome's collidable tiles (NO rng → identical on the
// server + every client, and the later monster-spawn rng stream is untouched). A biome with no
// collidable tile falls back to any collidable tile, then to a synthesized dark boundary tile. Walkable
// cells (already filled by fillMapWithTiles) and in-map collidable tiles (e.g. water) are left as-is.
const hashXY = (x, y) => (((x * 374761393) ^ (y * 668265263)) >>> 0); // matches the void-mote hash family
const VOID_FALLBACK_TILE = { name: "Boundary", biome: "", collidable: 1, rarity: 0,
  colorProfile_full_r: 17, colorProfile_full_g: 15, colorProfile_full_b: 24 };
function fillVoidWithBoundaryTiles(biomeMap, tileMap, allTiles) {
  const sortByName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); // stable, content-keyed
  const anyCollidable = allTiles.filter((t) => t.collidable).sort(sortByName);
  const byBiome = {};
  for (const t of anyCollidable) (byBiome[t.biome || ""] ||= []).push(t);
  for (let x = 0; x < MAP_SIZE; x++) {
    for (let y = 0; y < MAP_SIZE; y++) {
      if (tileMap[x][y] != null) continue; // already a walkable or in-map collidable tile
      const biomeName = biomeMap[x]?.[y]?.name || "";
      const pool = (byBiome[biomeName] && byBiome[biomeName].length) ? byBiome[biomeName]
        : (anyCollidable.length ? anyCollidable : [VOID_FALLBACK_TILE]);
      const pick = pool[hashXY(x, y) % pool.length];
      tileMap[x][y] = { ...pick, collidable: 1, rotation: 0, activeMonster: null };
    }
  }
}

// Squared distance / 195075 — matches Java's compareFullProfilesFast
function compareFullFast(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return 30 - (dr * dr + dg * dg + db * db) / 195075 * 30;
}

// GP-1/GP-2 (rarity wall fix): pick a monster type weighted by *location*. New players
// spawn toward the map edges and the storm shrinks the safe zone toward the center, so we
// bias low-rarity (catchable with a starter chain) monsters to the edges and the rare,
// powerful ones to the contested center/endgame. Pure + seeded (uses rng.next) → spawns
// stay deterministic for multiplayer. The curve constants are balance knobs (tune freely).
const MON_CENTER = (MAP_SIZE - 1) / 2;
const MON_MAX_D = Math.hypot(MON_CENTER, MON_CENTER);
function pickMonsterByLocation(types, x, y, rng) {
  if (!types || !types.length) return null; // empty pool → caller skips this spawn (no types[-1] crash)
  const edgeness = Math.min(1, Math.hypot(x - MON_CENTER, y - MON_CENTER) / MON_MAX_D); // 0 center … 1 edge
  const target = 5 - 3 * edgeness; // edge → ~2 (catchable), center → 5 (rare)
  let total = 0;
  const weights = types.map((t) => {
    const w = 1 / (1 + Math.pow(Math.abs((t.rarity ?? 3) - target), 1.6));
    total += w;
    return w;
  });
  let r = rng.next() * total;
  for (let i = 0; i < types.length; i++) {
    r -= weights[i];
    if (r <= 0) return types[i];
  }
  return types[types.length - 1];
}

// The distinct biome names present on a biomeMap (used when a round didn't pass an explicit set).
function distinctBiomeNames(biomeMap) {
  const names = new Set();
  for (let x = 0; x < MAP_SIZE; x++) for (let y = 0; y < MAP_SIZE; y++) { const b = biomeMap[x]?.[y]; if (b?.name) names.add(b.name); }
  return [...names];
}

// TQ-366: pick `n` monsters from priority-ordered `candidates` to MAXIMIZE diversity — bucket by
// rarity and round-robin across the buckets, so the pool spreads across rarity tiers instead of
// clumping. Within a bucket the candidates' incoming order is preserved (biome-matched first, then
// name-sorted backfill), so the result is deterministic + order-independent → server and every
// client build the IDENTICAL per-biome pool (the monster spawns stay reproducible for MP).
export function diverseMonsterPool(candidates, n) {
  const buckets = new Map();
  for (const m of candidates) {
    const r = Math.round(Number(m.rarity) || 3);
    if (!buckets.has(r)) buckets.set(r, []);
    buckets.get(r).push(m);
  }
  const order = [...buckets.keys()].sort((a, b) => a - b);
  const picked = [], seen = new Set();
  let progress = true;
  while (picked.length < n && progress) {
    progress = false;
    for (const r of order) {
      const b = buckets.get(r);
      while (b.length) {
        const m = b.shift();
        if (seen.has(m.typeName)) continue;
        seen.add(m.typeName); picked.push(m); progress = true;
        break;
      }
      if (picked.length >= n) break;
    }
  }
  return picked;
}

// TQ-366: build each biome's diversity-maximized monster pool of `comp.monstersPerBiome` (16) types.
// Biome-matched monsters (monster.biome === biome) are prioritized, then ALL types backfill so a
// biome always reaches the target even before its content is biome-tagged. Pure + sorted by name →
// identical on server + every client (the spawn pool is part of the deterministic map).
export function buildBiomeMonsterPools(allMonsters, comp, biomeNames) {
  const n = Math.max(1, (comp && comp.monstersPerBiome) | 0) || 1;
  const byName = (a, b) => (a.typeName < b.typeName ? -1 : a.typeName > b.typeName ? 1 : 0);
  const out = {};
  for (const biome of biomeNames) {
    const matched = allMonsters.filter((m) => m.biome === biome).sort(byName);
    const others = allMonsters.filter((m) => m.biome !== biome).sort(byName);
    out[biome] = diverseMonsterPool([...matched, ...others], n);
  }
  return out;
}

function spawnMonsters(voidMap, tileMap, rng, reachMap = null, biomeMap = null, monstersByBiome = null) {
  const maxMonsters = Math.floor(MAP_SIZE * MAP_SIZE * MONSTER_DENSITY);
  const allMonsterTypes = getMonsterTypes();
  const monsters = [];
  // No monster types yet (e.g. prod's seed is suppressed and the DB pool is empty/unreachable,
  // or a map is generated before initContent merges the pool) → spawn a monster-less but valid
  // map instead of crashing on an undefined type. Self-heals once the pool is populated.
  if (!allMonsterTypes.length) return monsters;

  let attempts = 0;
  while (monsters.length < maxMonsters && attempts < maxMonsters * 10) {
    attempts++;
    const x = rng.range(MAP_SIZE);
    const y = rng.range(MAP_SIZE);
    if (!voidMap[x][y] || !tileMap[x][y]) continue;
    if (tileMap[x][y].collidable) continue; // TQ-82: don't spawn on a collidable tile (e.g. water) — unreachable/unfightable
    if (reachMap && !reachMap[x][y]) continue; // TQ-83: only the largest reachable component (mutually reachable)
    if (tileMap[x][y].activeMonster) continue;

    // TQ-366: draw from the cell's biome-specific 16-pool when the round composed them; otherwise the
    // global pool (back-compat). pickMonsterByLocation consumes ONE rng draw regardless of pool size,
    // so the seeded stream is unchanged — only WHICH type is picked narrows to the biome's pool.
    const pool = (monstersByBiome && biomeMap)
      ? (monstersByBiome[biomeMap[x]?.[y]?.name] || allMonsterTypes)
      : allMonsterTypes;
    const monType = pickMonsterByLocation(pool.length ? pool : allMonsterTypes, x, y, rng);
    if (!monType) break; // defensive: empty pool (guarded above) — stop spawning rather than deref null
    const level = rng.int(GAME.SPAWN_LEVEL_MIN, GAME.SPAWN_LEVEL_MAX); // GP-10: was hardcoded 1-5; honor the config (admin/env-tunable)
    const stats = getMonsterStats(monType, level);
    const monster = {
      // Deterministic, map-unique id (no Date.now — keeps gen reproducible).
      id: `m_${x}_${y}`,
      typeName: monType.typeName,
      name: monType.typeName,
      level,
      xp: 0,
      currentHealth: stats.health,
      currentEnergy: stats.energy,
      status: null,
      tileX: x,
      tileY: y,
    };

    tileMap[x][y].activeMonster = monster;
    monsters.push(monster);
  }

  return monsters;
}

// TQ-83: the largest EFFECTIVELY-walkable connected component. voidMap is always a single
// connected component, but isWalkable also excludes collidable tiles (water), so the *playable*
// graph can split into isolated pockets. Flood-fill effective walkability (carved cell + present,
// non-collidable tile) over 4-connectivity and return a 2D boolean `reach` marking the biggest
// component — spawns are confined to it so every player + monster is mutually reachable. tileMap
// omitted → all carved cells count (no collidable info) → reach == voidMap's single component.
export function largestWalkableComponent(voidMap, tileMap = null) {
  const N = voidMap.length;
  const eff = (x, y) => !!voidMap[x]?.[y] && (!tileMap || (!!tileMap[x]?.[y] && !tileMap[x][y].collidable));
  const seen = Array.from({ length: N }, () => new Array(N).fill(false));
  let best = null, bestSize = -1;
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      if (!eff(x, y) || seen[x][y]) continue;
      const cells = [];
      const stack = [[x, y]];
      seen[x][y] = true;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        cells.push(cx, cy);
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && nx < N && ny >= 0 && ny < N && eff(nx, ny) && !seen[nx][ny]) {
            seen[nx][ny] = true;
            stack.push([nx, ny]);
          }
        }
      }
      if (cells.length > bestSize) { bestSize = cells.length; best = cells; }
    }
  }
  const reach = Array.from({ length: N }, () => new Array(N).fill(false));
  if (best) for (let i = 0; i < best.length; i += 2) reach[best[i]][best[i + 1]] = true;
  return reach;
}

// `rng` optional: pass a seeded RNG for deterministic spawns (server), or omit
// for a random spawn (single-player client).
export function findSpawnPoint(voidMap, rng, tileMap = null, reachMap = null) {
  const rand = rng ? rng.next : Math.random;
  // A spawn must be EFFECTIVELY walkable — a carved cell whose placed tile isn't collidable
  // (TQ-82), else the player lands stuck; and, when a reachMap is supplied, in the largest
  // reachable component (TQ-83). tileMap/reachMap omitted (older callers / tests) → fall back to
  // the voidMap-only test so behaviour is unchanged.
  const okTile = (x, y) =>
    (!tileMap || (!!tileMap[x]?.[y] && !tileMap[x][y].collidable)) &&
    (!reachMap || !!reachMap[x]?.[y]);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const x = Math.floor(rand() * (MAP_SIZE - 2)) + 1;
    const y = Math.floor(rand() * (MAP_SIZE - 2)) + 1;

    let allWalkable = true;
    for (let dx = -1; dx <= 1 && allWalkable; dx++) {
      for (let dy = -1; dy <= 1 && allWalkable; dy++) {
        if (!voidMap[x + dx][y + dy]) allWalkable = false;
      }
    }
    // 3×3 clearance (room to move) AND the spawn cell itself is not a collidable tile.
    if (allWalkable && okTile(x, y)) return { x, y };
  }
  for (let x = 1; x < MAP_SIZE - 1; x++)
    for (let y = 1; y < MAP_SIZE - 1; y++)
      if (voidMap[x][y] && okTile(x, y)) return { x, y };
  return { x: MAP_SIZE / 2, y: MAP_SIZE / 2 };
}

// GP-5: place `count` player spawns spread apart so 16 players don't all start on the
// same monster cluster (and, with PvP on, immediately on top of each other). Rejection-
// samples findSpawnPoint, re-rolling a bounded number of times to keep each spawn
// ≥ minSepTiles from the ones already placed — accepts a closer spot if separation
// can't be met (small/sparse cave), so it never loops forever. Deterministic with a
// seeded `rng`.
export function findSpreadSpawns(voidMap, rng, count, minSepTiles = 24, tileMap = null, reachMap = null) {
  const spawns = [];
  const minSq = minSepTiles * minSepTiles;
  const farEnough = (p) => spawns.every((s) => (s.x - p.x) ** 2 + (s.y - p.y) ** 2 >= minSq);
  for (let i = 0; i < count; i++) {
    let best = findSpawnPoint(voidMap, rng, tileMap, reachMap);
    for (let t = 0; t < 8 && !farEnough(best); t++) best = findSpawnPoint(voidMap, rng, tileMap, reachMap);
    spawns.push(best);
  }
  return spawns;
}
