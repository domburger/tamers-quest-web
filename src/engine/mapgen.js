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
 * Is the world-space point (x, y) walkable? Walkable = a DLA-carved floor cell
 * (`voidMap`) that has a present, non-collidable tile (e.g. water is collidable).
 * Shared collision rule: the server (tickRound), the SP client, and the MP client's
 * movement prediction all consume this so they agree on where walls are (no
 * "invisible wall" / "walk on water" drift). Null map → walkable (map still loading).
 * @param {{voidMap?:Array, tileMap?:Array}} map  a generateMap() result
 * @param {number} x @param {number} y  world px
 * @returns {boolean}
 */
export function isWalkable(map, x, y) {
  if (!map?.voidMap) return true;
  const E = GAME.EFFECTIVE_TILE;
  const tx = Math.floor(x / E), ty = Math.floor(y / E);
  const tile = map.tileMap?.[tx]?.[ty];
  return !!map.voidMap[tx]?.[ty] && !!tile && !tile.collidable;
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

// Rotation index map matching Java's ROT_MAP
// Indices: 0=top, 1=bottom, 2=left, 3=right
// ROT_MAP[r] = [topIdx, bottomIdx, leftIdx, rightIdx]
const ROT_MAP = [
  [0, 1, 2, 3], // rot 0: no rotation
  [2, 3, 1, 0], // rot 1: top←left, bottom←right, left←bottom, right←top
  [1, 0, 3, 2], // rot 2: top←bottom, bottom←top, left←right, right←left
  [3, 2, 0, 1], // rot 3: top←right, bottom←left, left←top, right←bottom
];

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Generate a map. Pass a `seed` (number or string) to reproduce a map exactly —
// required for multiplayer (server picks the seed, clients regenerate it). When
// omitted, a fresh random seed is used and returned in the result.
export async function generateMap(onProgress, seed) {
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
  generateBiomesVoronoi(biomeMap, rng);

  onProgress?.(0.60, "Selecting tiles...");
  const allTiles = getGroundTiles();
  const tilesByBiome = buildBiomePools(allTiles);
  await fillMapWithTiles(voidMap, biomeMap, tileMap, allTiles, tilesByBiome, onProgress, rng);

  onProgress?.(0.95, "Spawning monsters...");
  const monsters = spawnMonsters(voidMap, tileMap, rng);

  onProgress?.(1.0, "Done!");

  return { voidMap, biomeMap, tileMap, monsters, mapSize: MAP_SIZE, seed: actualSeed };
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

function dlaWalk(voidMap, startX, startY, rng) {
  const path = [];
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

function hasWalkableNeighbor(voidMap, x, y) {
  for (let d = 0; d < 4; d++) {
    const nx = Math.max(0, Math.min(MAP_SIZE - 1, x + DIRS[d][0]));
    const ny = Math.max(0, Math.min(MAP_SIZE - 1, y + DIRS[d][1]));
    if (voidMap[nx][ny]) return true;
  }
  return false;
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

// The biomes the Voronoi region picker draws from: the built-in BIOME_DEFS baseline plus any
// AI-GENERATED biomes (engine/gamedata `getBiomes`). Both the server and every client compute the
// SAME list — BIOME_DEFS is an identical const, and the generated pool is delivered to the client
// verbatim (server's order) via /api/biomes — so the seeded map stays deterministic across them.
function biomeList() {
  const gen = getBiomes();
  return gen && gen.length ? [...BIOME_DEFS, ...gen] : BIOME_DEFS;
}

function generateBiomesVoronoi(biomeMap, rng) {
  const pool = biomeList();
  const centers = [];
  for (let i = 0; i < NUM_BIOMES; i++) {
    centers.push({
      x: rng.range(MAP_SIZE),
      y: rng.range(MAP_SIZE),
      biome: rng.pick(pool),
    });
  }

  for (let x = 0; x < MAP_SIZE; x++) {
    for (let y = 0; y < MAP_SIZE; y++) {
      let minDist = Infinity;
      let closest = null;
      for (const center of centers) {
        const dx = x - center.x;
        const dy = y - center.y;
        const dist = dx * dx + dy * dy;
        if (dist < minDist) {
          minDist = dist;
          closest = center.biome;
        }
      }
      biomeMap[x][y] = closest;
    }
  }
}

function buildBiomePools(allTiles) {
  const pools = {};
  for (const tile of allTiles) {
    const b = tile.biome || "unknown";
    if (!pools[b]) pools[b] = [];
    pools[b].push(tile);
  }
  return pools;
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

      // Pre-compute rotated neighbor profiles (only left and top are filled in raster order)
      const leftN = x > 0 ? tileMap[x - 1][y] : null;
      const rightN = x < MAP_SIZE - 1 ? tileMap[x + 1][y] : null;
      // y-1 = above on screen (Kaboom y↓), current tile's TOP faces neighbor's BOTTOM
      const aboveN = y > 0 ? tileMap[x][y - 1] : null;
      // y+1 = below on screen, current tile's BOTTOM faces neighbor's TOP
      const belowN = y < MAP_SIZE - 1 ? tileMap[x][y + 1] : null;

      // Pre-extract rotated neighbor side values
      const leftRP = leftN ? getRotatedSides(leftN) : null;
      const rightRP = rightN ? getRotatedSides(rightN) : null;
      const aboveRP = aboveN ? getRotatedSides(aboveN) : null;
      const belowRP = belowN ? getRotatedSides(belowN) : null;

      let bestTile = null;
      let bestScore = -Infinity;
      let bestRotation = 0;

      for (const tile of candidates) {
        // Pre-extract side colors: [top, bottom, left, right]
        const sR = [tile.colorProfile_top_r, tile.colorProfile_bottom_r, tile.colorProfile_left_r, tile.colorProfile_right_r];
        const sG = [tile.colorProfile_top_g, tile.colorProfile_bottom_g, tile.colorProfile_left_g, tile.colorProfile_right_g];
        const sB = [tile.colorProfile_top_b, tile.colorProfile_bottom_b, tile.colorProfile_left_b, tile.colorProfile_right_b];
        const fR = tile.colorProfile_full_r, fG = tile.colorProfile_full_g, fB = tile.colorProfile_full_b;

        // Random factor computed once per tile (same for all rotations, matching Java)
        const baseScore = (biomeMatched ? 50 : 0) + rng.next() * 16;

        for (let r = 0; r < 4; r++) {
          let score = baseScore;
          const rm = ROT_MAP[r];
          // rm[2] = left side index after rotation, rm[3] = right, rm[0] = top, rm[1] = bottom

          // Left neighbor: tile's left side vs neighbor's right side
          if (leftRP) {
            score += compareSideFast(sR[rm[2]], sG[rm[2]], sB[rm[2]], leftRP.rR, leftRP.rG, leftRP.rB);
            score += compareFullFast(fR, fG, fB, leftRP.fR, leftRP.fG, leftRP.fB);
          }
          // Right neighbor: tile's right side vs neighbor's left side
          if (rightRP) {
            score += compareSideFast(sR[rm[3]], sG[rm[3]], sB[rm[3]], rightRP.lR, rightRP.lG, rightRP.lB);
            score += compareFullFast(fR, fG, fB, rightRP.fR, rightRP.fG, rightRP.fB);
          }
          // Above neighbor (y-1): tile's TOP side vs neighbor's BOTTOM side
          if (aboveRP) {
            score += compareSideFast(sR[rm[0]], sG[rm[0]], sB[rm[0]], aboveRP.bR, aboveRP.bG, aboveRP.bB);
            score += compareFullFast(fR, fG, fB, aboveRP.fR, aboveRP.fG, aboveRP.fB);
          }
          // Below neighbor (y+1): tile's BOTTOM side vs neighbor's TOP side
          if (belowRP) {
            score += compareSideFast(sR[rm[1]], sG[rm[1]], sB[rm[1]], belowRP.tR, belowRP.tG, belowRP.tB);
            score += compareFullFast(fR, fG, fB, belowRP.fR, belowRP.fG, belowRP.fB);
          }

          if (score > bestScore) {
            bestScore = score;
            bestTile = tile;
            bestRotation = r;
          }
        }
      }

      if (bestTile) {
        tileMap[x][y] = {
          ...bestTile,
          rotation: bestRotation * 90,
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

// Extract rotated side values for a placed tile (applying its rotation)
function getRotatedSides(tile) {
  const rot = ((tile.rotation || 0) / 90) % 4;
  const tR = [tile.colorProfile_top_r, tile.colorProfile_bottom_r, tile.colorProfile_left_r, tile.colorProfile_right_r];
  const tG = [tile.colorProfile_top_g, tile.colorProfile_bottom_g, tile.colorProfile_left_g, tile.colorProfile_right_g];
  const tB = [tile.colorProfile_top_b, tile.colorProfile_bottom_b, tile.colorProfile_left_b, tile.colorProfile_right_b];
  const rm = ROT_MAP[rot];
  return {
    tR: tR[rm[0]], tG: tG[rm[0]], tB: tB[rm[0]], // top
    bR: tR[rm[1]], bG: tG[rm[1]], bB: tB[rm[1]], // bottom
    lR: tR[rm[2]], lG: tG[rm[2]], lB: tB[rm[2]], // left
    rR: tR[rm[3]], rG: tG[rm[3]], rB: tB[rm[3]], // right
    fR: tile.colorProfile_full_r, fG: tile.colorProfile_full_g, fB: tile.colorProfile_full_b,
  };
}

// Squared distance / 195075 — matches Java's compareSideProfilesFast
function compareSideFast(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return 50 - (dr * dr + dg * dg + db * db) / 195075 * 50;
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

function spawnMonsters(voidMap, tileMap, rng) {
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
    if (tileMap[x][y].activeMonster) continue;

    const monType = pickMonsterByLocation(allMonsterTypes, x, y, rng);
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

// `rng` optional: pass a seeded RNG for deterministic spawns (server), or omit
// for a random spawn (single-player client).
export function findSpawnPoint(voidMap, rng) {
  const rand = rng ? rng.next : Math.random;
  for (let attempt = 0; attempt < 1000; attempt++) {
    const x = Math.floor(rand() * (MAP_SIZE - 2)) + 1;
    const y = Math.floor(rand() * (MAP_SIZE - 2)) + 1;

    let allWalkable = true;
    for (let dx = -1; dx <= 1 && allWalkable; dx++) {
      for (let dy = -1; dy <= 1 && allWalkable; dy++) {
        if (!voidMap[x + dx][y + dy]) allWalkable = false;
      }
    }
    if (allWalkable) return { x, y };
  }
  for (let x = 1; x < MAP_SIZE - 1; x++)
    for (let y = 1; y < MAP_SIZE - 1; y++)
      if (voidMap[x][y]) return { x, y };
  return { x: MAP_SIZE / 2, y: MAP_SIZE / 2 };
}

// GP-5: place `count` player spawns spread apart so 16 players don't all start on the
// same monster cluster (and, with PvP on, immediately on top of each other). Rejection-
// samples findSpawnPoint, re-rolling a bounded number of times to keep each spawn
// ≥ minSepTiles from the ones already placed — accepts a closer spot if separation
// can't be met (small/sparse cave), so it never loops forever. Deterministic with a
// seeded `rng`.
export function findSpreadSpawns(voidMap, rng, count, minSepTiles = 24) {
  const spawns = [];
  const minSq = minSepTiles * minSepTiles;
  const farEnough = (p) => spawns.every((s) => (s.x - p.x) ** 2 + (s.y - p.y) ** 2 >= minSq);
  for (let i = 0; i < count; i++) {
    let best = findSpawnPoint(voidMap, rng);
    for (let t = 0; t < 8 && !farEnough(best); t++) best = findSpawnPoint(voidMap, rng);
    spawns.push(best);
  }
  return spawns;
}
