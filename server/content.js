import { addMonsterType, removeMonsterType, getMonsterTypes, addItem, removeItem, getItems,
  addGroundTile, removeGroundTile, getGroundTiles, addBiome, removeBiome, getBiomes } from "../src/engine/gamedata.js";
import { aiGenerateItem } from "./genItems.js";
import { aiGenerateTile } from "./genTiles.js";
import { aiGenerateBiome } from "./genBiomes.js";
import { dbEnabled, loadMonsterTypes, upsertMonsterType, deleteMonsterType, loadItems, upsertItem, deleteItem,
  loadGroundTiles, upsertGroundTile, deleteGroundTile, loadBiomes, upsertBiome, deleteBiome } from "./db.js";
import { aiGenerateMonsterV2 } from "./genStages.js";
import { BIOME_DEFS } from "../src/engine/mapgen.js";
import { roundComposition } from "./genConfig.js";

let monstersInFlight = 0;
let maxMonsterGen = 1;
export function setMonsterGenConcurrency(n) { maxMonsterGen = Math.max(1, Math.floor(Number(n) || 0) || 1); }

let genInFlight = { active: false, type: null, startedAt: 0 };
export function genInFlightState() {
  return genInFlight.active ? { active: true, type: genInFlight.type, startedAt: genInFlight.startedAt } : { active: false };
}
async function trackGen(type, fn) {
  genInFlight = { active: true, type, startedAt: Date.now() };
  try { return await fn(); }
  finally { genInFlight = { active: false, type: null, startedAt: 0 }; }
}

function diversitySeed(opts) {
  return opts;
}
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

export async function initContent() {
  const file = process.env.CONTENT_MONSTERS_JSON;
  if (file && !process.env.RAILWAY_ENVIRONMENT) {
    try {
      const { readFileSync } = await import("node:fs");
      const arr = JSON.parse(readFileSync(file, "utf8"));
      let n = 0;
      for (const mt of Array.isArray(arr) ? arr : []) if (mt && mt.typeName && addMonsterType(mt)) n++;
      console.log(`[content] loaded ${n} monster type(s) from ${file} (local QA)`);
    } catch (e) { console.error("[content] CONTENT_MONSTERS_JSON failed:", e.message); }
  }
  if (!dbEnabled()) return 0;
  let added = 0;
  try {
    for (const mt of await loadMonsterTypes()) if (addMonsterType(mt)) added++;
    let items = 0;
    for (const it of await loadItems()) if (addItem(it)) items++;
    if (items) console.log(`[content] loaded ${items} generated item(s) from Postgres`);
    let biomes = 0;
    for (const b of await loadBiomes()) if (addBiome(b)) biomes++;
    if (biomes) console.log(`[content] loaded ${biomes} generated biome(s) from Postgres`);
    let tiles = 0;
    for (const t of await loadGroundTiles()) if (addGroundTile(t)) tiles++;
    if (tiles) console.log(`[content] loaded ${tiles} generated floor tile(s) from Postgres`);
  } catch (e) {
    console.error("[content] load failed:", e.message);
    return 0;
  }
  if (added) console.log(`[content] loaded ${added} generated monster type(s) from Postgres`);
  return added;
}

export async function generateMonster(opts = {}, deps = {}) {
  if (monstersInFlight >= maxMonsterGen) return null;
  monstersInFlight++;
  try {
   return await trackGen("monster", async () => {
    const existingNames = new Set(getMonsterTypes().map((m) => m.typeName));
    const mt = await aiGenerateMonsterV2({ ...diversitySeed(opts), existingNames }, deps);
    if (!mt) return null;
    if (opts.dryRun) return mt;
    if (!addMonsterType(mt)) return null;
    await upsertMonsterType(mt).catch((e) => console.error("[content] persist:", e.message));
    console.log(`[content] generated monster: ${mt.typeName}`);
    return mt;
   });
  } finally {
    monstersInFlight--;
  }
}

const ITEM_KINDS = [
  { prompt: "a HEALING potion that restores a good chunk of the USER's own monster's health", rarity: "uncommon", effect: { kind: "heal", target: "self", magnitude: "big" } },
  { prompt: "a HEALING salve that restores some of the USER's own monster's health", rarity: "common", effect: { kind: "heal", target: "self", magnitude: "small" } },
  { prompt: "an ENERGY draught that restores the USER's own monster's energy", rarity: "common", effect: { kind: "energy", target: "self" } },
  { prompt: "a CLEANSING remedy that cures the USER's own monster's status ailment (burn/poison/freeze/etc.)", rarity: "uncommon", effect: { kind: "cleanse", target: "self" } },
  { prompt: "a GUARD charm that raises the USER's own monster's defense or power for a few turns", rarity: "uncommon", effect: { kind: "buff", target: "self", stat: "defense" } },
  { prompt: "a SWIFT tonic that raises the USER's own monster's speed or accuracy for a few turns", rarity: "uncommon", effect: { kind: "buff", target: "self", stat: "speed" } },
  { prompt: "an offensive BOMB that deals direct damage to the ENEMY monster", rarity: "rare", effect: { kind: "damage", target: "enemy" } },
  { prompt: "a SNARE that weakens or hinders the ENEMY monster (lowers a stat or slows it)", rarity: "uncommon", effect: { kind: "debuff", target: "enemy", stat: "defense" } },
  { prompt: "a TOXIN that inflicts burn, poison, or freeze on the ENEMY monster", rarity: "rare", effect: { kind: "status", target: "enemy" } },
];
export function itemDiversitySeed(opts) {
  if (opts.kind) return opts;
  const k = pickRandom(ITEM_KINDS);
  return { ...opts, kind: k.prompt, _meta: { category: "consumable", rarity: k.rarity, effect: k.effect } };
}

export async function generateItem(opts = {}) {
 return trackGen("item", async () => {
  const pool = getItems();
  const existingNames = new Set(pool.map((it) => it.name));
  const nextId = pool.reduce((m, it) => Math.max(m, Number(it.id) || 0), 0) + 1;
  const seed = itemDiversitySeed(opts);
  const { _meta, ...aiOpts } = seed;
  const it = await aiGenerateItem({ ...aiOpts, existingNames, id: opts.id ?? nextId });
  if (!it) return null;
  if (_meta) { it.category = it.category || _meta.category; it.rarity = it.rarity || _meta.rarity; it.effect = it.effect || _meta.effect; }
  if (opts.dryRun) return it;
  if (!addItem(it)) return null;
  await upsertItem(it).catch((e) => console.error("[content] item persist:", e.message));
  console.log(`[content] generated item: ${it.name}`);
  return it;
 });
}

export async function removeGenItem(name) {
  await deleteItem(name).catch(() => false);
  return removeItem(name);
}

const BIOME_KINDS = [
  "a molten volcanic flat of cooling lava and ash",
  "a drowned flooded cavern of black water and pale fungus",
  "a bioluminescent fungal grove that glows in the dark",
  "a frozen crystalline vault of ice and frost",
  "a corroded metal foundry of rust and slag",
  "a bone-strewn ossuary of pale chalk and dust",
  "a toxic mire of bubbling poison and rot",
  "a shattered arcane sanctum humming with strange light",
  "a wind-scoured stone barrens of grit and shale",
  "a crystal-veined grotto of glittering mineral",
];
function biomeDiversitySeed(opts) {
  return opts.kind ? opts : { ...opts, kind: pickRandom(BIOME_KINDS) };
}

function allBiomeNames() {
  return [...BIOME_DEFS.map((b) => b.name), ...getBiomes().map((b) => b.name)];
}

export async function generateBiome(opts = {}) {
 return trackGen("biome", async () => {
  const existingNames = new Set(allBiomeNames());
  const b = await aiGenerateBiome({ ...biomeDiversitySeed(opts), existingNames });
  if (!b) return null;
  if (opts.dryRun) return b;
  if (!addBiome(b)) return null;
  await upsertBiome(b).catch((e) => console.error("[content] biome persist:", e.message));
  console.log(`[content] generated biome: ${b.name}`);
  return b;
 });
}

export async function removeGenBiome(name) {
  await deleteBiome(name).catch(() => false);
  return removeBiome(name);
}

const TILE_KINDS_WALK = [
  "cracked rock slab", "loose gravel and grit", "damp glowing moss", "packed dark soil",
  "fine drifting ash", "wet flowstone", "scorched blackened earth", "crystalline crust",
];
const TILE_KINDS_SOLID = [
  "deep churning water", "a molten lava flow", "a sheer rock wall", "a bottomless chasm",
  "jagged impassable spires", "a wall of solid ice", "a bubbling tar pit", "a towering mineral wall",
];
const isSolid = (v) => v === 1 || v === true || v === "1" || v === "true";
const isWalk = (v) => v === 0 || v === false || v === "0" || v === "false";
export function tileDiversitySeed(opts) {
  const out = { ...opts };
  if (!out.biome) { const names = allBiomeNames(); out.biome = names.length ? pickRandom(names) : "Stone"; }
  if (!out.kind) {
    const pool = isSolid(out.collidable) ? TILE_KINDS_SOLID
      : isWalk(out.collidable) ? TILE_KINDS_WALK
      : (Math.random() < 0.33 ? TILE_KINDS_SOLID : TILE_KINDS_WALK);
    out.kind = pickRandom(pool);
  }
  return out;
}

function liveBiomeTileCounts() {
  const counts = {};
  for (const t of getGroundTiles()) {
    const b = t.biome || "Wilds";
    (counts[b] ||= { collidable: 0, walk: 0 })[t.collidable ? "collidable" : "walk"]++;
  }
  return counts;
}
function tileTargets() {
  const c = roundComposition();
  return { collidable: c.tilesCollidablePerBiome, walk: c.tilesNonCollidablePerBiome };
}
export function neediestTileTarget(biomes, counts, targets, opts = {}, rand = Math.random) {
  const list = (biomes && biomes.length) ? biomes : ["Stone"];
  const pinBiome = opts.biome && list.includes(opts.biome) ? opts.biome : null;
  const pinColl = isSolid(opts.collidable) ? 1 : isWalk(opts.collidable) ? 0 : null;
  const cands = [];
  for (const b of list) {
    if (pinBiome && b !== pinBiome) continue;
    const c = counts[b] || { collidable: 0, walk: 0 };
    for (const coll of (pinColl == null ? [1, 0] : [pinColl])) {
      const have = coll ? c.collidable : c.walk;
      const want = coll ? targets.collidable : targets.walk;
      cands.push({ biome: b, collidable: coll, deficit: want - have });
    }
  }
  if (!cands.length) return { biome: pinBiome || list[0], collidable: pinColl ?? 0 };
  const maxDef = Math.max(...cands.map((c) => c.deficit));
  const pool = maxDef > 0 ? cands.filter((c) => c.deficit === maxDef) : cands;
  const pick = pool[Math.floor(rand() * pool.length)];
  return { biome: pick.biome, collidable: pick.collidable };
}

export async function generateTile(opts = {}) {
 return trackGen("tile", async () => {
  const pool = getGroundTiles();
  const existingNames = new Set(pool.map((t) => t.name));
  const nextId = pool.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0) + 1;
  // Use ?? not ||: an explicit collidable 0 must survive.
  const target = neediestTileTarget(allBiomeNames(), liveBiomeTileCounts(), tileTargets(), opts);
  const balanced = { ...opts, biome: opts.biome ?? target.biome, collidable: opts.collidable ?? target.collidable };
  const t = await aiGenerateTile({ ...tileDiversitySeed(balanced), existingNames, id: opts.id ?? nextId });
  if (!t) return null;
  if (opts.dryRun) return t;
  if (!addGroundTile(t)) return null;
  await upsertGroundTile(t).catch((e) => console.error("[content] tile persist:", e.message));
  console.log(`[content] generated floor tile: ${t.name} (${t.biome})`);
  return t;
 });
}

export async function removeGenTile(name) {
  await deleteGroundTile(name).catch(() => false);
  return removeGroundTile(name);
}

export async function removeMonster(name) {
  const wasGenerated = await deleteMonsterType(name).catch(() => false);
  if (wasGenerated) removeMonsterType(name);
  return wasGenerated;
}

export async function saveGeneratedMonster(mt) {
  if (!addMonsterType(mt)) return false;
  await upsertMonsterType(mt).catch((e) => console.error("[content] save monster:", e.message));
  return true;
}
export async function saveGeneratedItem(it) {
  if (!addItem(it)) return false;
  await upsertItem(it).catch((e) => console.error("[content] save item:", e.message));
  return true;
}
export async function saveGeneratedBiome(b) {
  if (!addBiome(b)) return false;
  await upsertBiome(b).catch((e) => console.error("[content] save biome:", e.message));
  return true;
}
export async function saveGeneratedTile(t) {
  if (!addGroundTile(t)) return false;
  await upsertGroundTile(t).catch((e) => console.error("[content] save tile:", e.message));
  return true;
}
