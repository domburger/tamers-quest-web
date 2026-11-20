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

export const DEFAULT_TILES = [
  { id: -901, name: "default-floor-a", biome: "", collidable: 0, rarity: 10, colorProfile_full_r: 78, colorProfile_full_g: 74, colorProfile_full_b: 90 },
  { id: -902, name: "default-floor-b", biome: "", collidable: 0, rarity: 10, colorProfile_full_r: 68, colorProfile_full_g: 66, colorProfile_full_b: 82 },
  { id: -903, name: "default-floor-c", biome: "", collidable: 0, rarity: 10, colorProfile_full_r: 86, colorProfile_full_g: 80, colorProfile_full_b: 96 },
  { id: -904, name: "default-wall", biome: "", collidable: 1, rarity: 10, colorProfile_full_r: 46, colorProfile_full_g: 42, colorProfile_full_b: 56 },
];

export function biomeTintAt(map, tx, ty) {
  return map?.biomeMap?.[tx]?.[ty]?.tint ?? null;
}

export function isWalkable(map, x, y) {
  if (!map?.tileMap) return true;
  const E = GAME.EFFECTIVE_TILE;
  const tx = Math.floor(x / E), ty = Math.floor(y / E);
  const tile = map.tileMap?.[tx]?.[ty];
  return !!tile && !tile.collidable;
}

export function edgeClearX(map, ex, y, R) {
  return isWalkable(map, ex, y) && isWalkable(map, ex, y - R) && isWalkable(map, ex, y + R);
}
export function edgeClearY(map, x, ey, R) {
  return isWalkable(map, x, ey) && isWalkable(map, x - R, ey) && isWalkable(map, x + R, ey);
}

export const CORNER_SLIP = 10;

export function stepBody(map, x, y, dx, dy, dist, R, maxXY = 0) {
  const clamp = (v) => (maxXY ? Math.min(maxXY, Math.max(0, v)) : Math.max(0, v));
  const nx = clamp(x + dx * dist), ny = clamp(y + dy * dist);
  const clearX = edgeClearX(map, nx + Math.sign(dx) * R, y, R);
  if (clearX) x = nx;
  const clearY = edgeClearY(map, x, ny + Math.sign(dy) * R, R);
  if (clearY) y = ny;
  let slipped = false;
  if (dx && !dy && !clearX) {
    const s = slipShift((o) => edgeClearX(map, nx + Math.sign(dx) * R, y + o, R) && edgeClearY(map, x, y + o + Math.sign(o) * R, R));
    if (s) { y = clamp(y + Math.sign(s) * Math.min(dist, Math.abs(s))); slipped = true; }
  } else if (dy && !dx && !clearY) {
    const s = slipShift((o) => edgeClearY(map, x + o, ny + Math.sign(dy) * R, R) && edgeClearX(map, x + o + Math.sign(o) * R, y, R));
    if (s) { x = clamp(x + Math.sign(s) * Math.min(dist, Math.abs(s))); slipped = true; }
  }
  const blocked = !slipped && ((dx && !clearX) || (dy && !clearY)) && !((dx && clearX) || (dy && clearY));
  return { x, y, blocked };
}
function slipShift(test) {
  for (let o = 1; o <= CORNER_SLIP; o++) { if (test(o)) return o; if (test(-o)) return -o; }
  return 0;
}

export function biomeNameAt(map, worldX, worldY) {
  const bm = map?.biomeMap;
  if (!bm) return null;
  const E = GAME.EFFECTIVE_TILE;
  const N = bm.length;
  const tx = Math.max(0, Math.min(N - 1, Math.floor(worldX / E)));
  const ty = Math.max(0, Math.min(N - 1, Math.floor(worldY / E)));
  return bm[tx]?.[ty]?.name ?? null;
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Must stay deterministic: server and clients rebuild the same map from seed.
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
  const allTiles = getGroundTiles();
  const tiles = allTiles.length ? allTiles : DEFAULT_TILES;
  const tilesByBiome = buildBiomePools(tiles, comp);
  await fillMapWithTiles(voidMap, biomeMap, tileMap, tiles, tilesByBiome, onProgress, rng);
  fillVoidWithBoundaryTiles(biomeMap, tileMap, tiles);

  onProgress?.(0.95, "Spawning monsters...");
  const reachMap = largestWalkableComponent(voidMap, tileMap);
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

  for (let pass = 0; pass < SMOOTHING_PASSES; pass++) {
    smoothMap(voidMap);
    widenNarrowTunnels(voidMap);
  }
}

const _dlaPath = [];
function dlaWalk(voidMap, startX, startY, rng) {
  const path = _dlaPath; path.length = 0;
  let x = startX, y = startY;

  for (let step = 0; step < MAX_DLA_STEPS; step++) {
    path.push(x, y);

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

function widenNarrowTunnels(voidMap) {
  for (let x = 1; x < MAP_SIZE - 1; x++) {
    for (let y = 1; y < MAP_SIZE - 1; y++) {
      if (!voidMap[x][y]) continue;
      if (!voidMap[x - 1][y] && !voidMap[x + 1][y] && voidMap[x][y - 1] && voidMap[x][y + 1]) {
        voidMap[x - 1][y] = true;
        voidMap[x + 1][y] = true;
      }
      if (!voidMap[x][y - 1] && !voidMap[x][y + 1] && voidMap[x - 1][y] && voidMap[x + 1][y]) {
        voidMap[x][y - 1] = true;
        voidMap[x][y + 1] = true;
      }
    }
  }
}

let aiOnlyBiomes = false;
export function setAiOnlyBiomes(v) { aiOnlyBiomes = !!v; }
function builtinBiomes() { return aiOnlyBiomes ? [] : BIOME_DEFS; }

function biomeList() {
  const gen = getBiomes();
  const out = gen && gen.length ? [...builtinBiomes(), ...gen] : [...builtinBiomes()];
  return out.length ? out : [...BIOME_DEFS];
}

export function allBiomes() {
  const gen = getBiomes();
  const out = gen && gen.length ? [...builtinBiomes(), ...gen] : [...builtinBiomes()];
  return out.length ? out : [...BIOME_DEFS];
}

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
    for (const biome of biomeSet) {
      centers.push({ x: rng.range(MAP_SIZE), y: rng.range(MAP_SIZE), biome });
    }
  } else {
    const pool = biomeList();
    const n = Math.min(NUM_BIOMES, pool.length);
    for (let i = 0; i < n; i++) {
      centers.push({
        x: rng.range(MAP_SIZE),
        y: rng.range(MAP_SIZE),
        biome: pickBiomeByRarity(pool, rng),
      });
    }
  }

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

// Pick by content key (rarity, name), never pool order: server/client must match.
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
  const hasHtmlTex = (t) => !!(t && t.html && typeof t.html.base === "string" && t.html.base.trim());
  const byContent = (a, b) => (Number(a.rarity || 0) - Number(b.rarity || 0)) || ((a.name || "") < (b.name || "") ? -1 : (a.name || "") > (b.name || "") ? 1 : 0);
  const out = {};
  for (const biome of Object.keys(pools)) {
    const tiles = pools[biome];
    const ai = tiles.filter(hasHtmlTex);
    const source = ai.length ? ai : tiles;
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

      const leftN = x > 0 ? tileMap[x - 1][y] : null;
      const rightN = x < MAP_SIZE - 1 ? tileMap[x + 1][y] : null;
      const aboveN = y > 0 ? tileMap[x][y - 1] : null;
      const belowN = y < MAP_SIZE - 1 ? tileMap[x][y + 1] : null;

      let bestTile = null;
      let bestScore = -Infinity;

      for (const tile of candidates) {
        const fR = tile.colorProfile_full_r, fG = tile.colorProfile_full_g, fB = tile.colorProfile_full_b;
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

const hashXY = (x, y) => (((x * 374761393) ^ (y * 668265263)) >>> 0);
const VOID_FALLBACK_TILE = { name: "Boundary", biome: "", collidable: 1, rarity: 0,
  colorProfile_full_r: 17, colorProfile_full_g: 15, colorProfile_full_b: 24 };
function fillVoidWithBoundaryTiles(biomeMap, tileMap, allTiles) {
  const sortByName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const anyCollidable = allTiles.filter((t) => t.collidable).sort(sortByName);
  const byBiome = {};
  for (const t of anyCollidable) (byBiome[t.biome || ""] ||= []).push(t);
  for (let x = 0; x < MAP_SIZE; x++) {
    for (let y = 0; y < MAP_SIZE; y++) {
      if (tileMap[x][y] != null) continue;
      const biomeName = biomeMap[x]?.[y]?.name || "";
      const pool = (byBiome[biomeName] && byBiome[biomeName].length) ? byBiome[biomeName]
        : (anyCollidable.length ? anyCollidable : [VOID_FALLBACK_TILE]);
      const pick = pool[hashXY(x, y) % pool.length];
      tileMap[x][y] = { ...pick, collidable: 1, rotation: 0, activeMonster: null };
    }
  }
}

function compareFullFast(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return 30 - (dr * dr + dg * dg + db * db) / 195075 * 30;
}

const MON_CENTER = (MAP_SIZE - 1) / 2;
const MON_MAX_D = Math.hypot(MON_CENTER, MON_CENTER);
function pickMonsterByLocation(types, x, y, rng) {
  if (!types || !types.length) return null;
  const edgeness = Math.min(1, Math.hypot(x - MON_CENTER, y - MON_CENTER) / MON_MAX_D);
  const target = 5 - 3 * edgeness;
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

function distinctBiomeNames(biomeMap) {
  const names = new Set();
  for (let x = 0; x < MAP_SIZE; x++) for (let y = 0; y < MAP_SIZE; y++) { const b = biomeMap[x]?.[y]; if (b?.name) names.add(b.name); }
  return [...names];
}

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
  if (!allMonsterTypes.length) return monsters;

  let attempts = 0;
  while (monsters.length < maxMonsters && attempts < maxMonsters * 10) {
    attempts++;
    const x = rng.range(MAP_SIZE);
    const y = rng.range(MAP_SIZE);
    if (!voidMap[x][y] || !tileMap[x][y]) continue;
    if (tileMap[x][y].collidable) continue;
    if (reachMap && !reachMap[x][y]) continue;
    if (tileMap[x][y].activeMonster) continue;

    // Exactly one rng draw per cell regardless of pool: the seeded stream must stay in sync.
    const pool = (monstersByBiome && biomeMap)
      ? (monstersByBiome[biomeMap[x]?.[y]?.name] || allMonsterTypes)
      : allMonsterTypes;
    const monType = pickMonsterByLocation(pool.length ? pool : allMonsterTypes, x, y, rng);
    if (!monType) break;
    const level = rng.int(GAME.SPAWN_LEVEL_MIN, GAME.SPAWN_LEVEL_MAX);
    const stats = getMonsterStats(monType, level);
    const monster = {
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

export function findSpawnPoint(voidMap, rng, tileMap = null, reachMap = null) {
  const rand = rng ? rng.next : Math.random;
  const okTile = (x, y) =>
    (!tileMap || (!!tileMap[x]?.[y] && !tileMap[x][y].collidable)) &&
    (!reachMap || !!reachMap[x]?.[y]);
  const open = (x, y) => !!voidMap[x]?.[y] && (!tileMap || (!!tileMap[x]?.[y] && !tileMap[x][y].collidable));
  const clearance = (x, y, r) => {
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (!open(x + dx, y + dy)) return false;
    return true;
  };
  for (let attempt = 0; attempt < 1000; attempt++) {
    const x = Math.floor(rand() * (MAP_SIZE - 2)) + 1;
    const y = Math.floor(rand() * (MAP_SIZE - 2)) + 1;
    if (clearance(x, y, 1) && okTile(x, y)) return { x, y };
  }
  for (let x = 1; x < MAP_SIZE - 1; x++)
    for (let y = 1; y < MAP_SIZE - 1; y++)
      if (open(x, y) && okTile(x, y) && (open(x + 1, y) || open(x - 1, y) || open(x, y + 1) || open(x, y - 1))) return { x, y };
  for (let x = 1; x < MAP_SIZE - 1; x++)
    for (let y = 1; y < MAP_SIZE - 1; y++)
      if (voidMap[x][y] && okTile(x, y)) return { x, y };
  return { x: MAP_SIZE / 2, y: MAP_SIZE / 2 };
}

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
