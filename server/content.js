// AI content pipeline (P5). Bridges the generator (gen.js) to the live monster
// pool (engine/gamedata) and durable storage (db.js):
//   initContent()      — load previously-generated monster types into the pool at boot
//   generateMonster()  — make one new monster, add it to the pool, and persist it
//
// Generation makes a live OpenAI call (cost), so it's invoked only when enabled
// (MONSTER_GEN_RATE > 0, wired in world.js). Loading + serving the pool is free.

import { addMonsterType, removeMonsterType, getMonsterTypes, addItem, removeItem, getItems,
  addGroundTile, removeGroundTile, getGroundTiles, addBiome, removeBiome, getBiomes } from "../src/engine/gamedata.js";
import { aiGenerateItem } from "./genItems.js";
import { aiGenerateTile } from "./genTiles.js";
import { aiGenerateBiome } from "./genBiomes.js";
import { dbEnabled, loadMonsterTypes, upsertMonsterType, deleteMonsterType, loadItems, upsertItem, deleteItem,
  loadGroundTiles, upsertGroundTile, deleteGroundTile, loadBiomes, upsertBiome, deleteBiome } from "./db.js";
import { aiGenerateMonsterV2 } from "./genStages.js"; // multi-agent pipeline (Idea→Attributes[→Model])
import { BIOME_DEFS } from "../src/engine/mapgen.js"; // built-in biome baseline (for unique-name seeding)
import { roundComposition } from "./genConfig.js"; // per-biome collidable/walkable tile targets (balancing)

let generating = false; // simple guard against overlapping generations (monster gen single-flight)

// TQ-317: live in-flight visibility for the admin zone. genInFlight tracks the CURRENT generation
// (type + start time) so the admin stats endpoint can show "Generating monster… 3s" instead of an
// operator guessing why a new gen request was rejected. This is DISPLAY state, separate from the
// `generating` single-flight guard above; trackGen() clears it in a finally so a crashed/failed gen
// can never leave a phantom "in progress".
let genInFlight = { active: false, type: null, startedAt: 0 };
export function genInFlightState() {
  return genInFlight.active ? { active: true, type: genInFlight.type, startedAt: genInFlight.startedAt } : { active: false };
}
async function trackGen(type, fn) {
  genInFlight = { active: true, type, startedAt: Date.now() };
  try { return await fn(); }
  finally { genInFlight = { active: false, type: null, startedAt: 0 }; }
}

// Diversity seed for hint-less generation. TQ-348: the previous seed fabricated a random
// {element, biome} "element-wheel" theme + silhouette for every hint-less generation — but the
// "element" concept does not exist in this game, so that injected a bogus "build the monster
// AROUND this element" constraint. It is now a pass-through: hint-less generation passes NO
// targeting hints (no Constraints block), and an explicit biome/archetype/rarity (a targeted
// spawn or admin request) is respected as-is. Re-introducing a non-element diversity mechanism,
// if the Idea agent converges, is tracked in TQ-349 (full element removal).
function diversitySeed(opts) {
  return opts;
}
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Merge previously-generated monster types from the DB into the live pool so they
// spawn (server-authoritative) and the client can render them.
export async function initContent() {
  if (!dbEnabled()) return 0;
  let added = 0;
  try {
    for (const mt of await loadMonsterTypes()) if (addMonsterType(mt)) added++;
    let items = 0;
    for (const it of await loadItems()) if (addItem(it)) items++;
    if (items) console.log(`[content] loaded ${items} generated item(s) from Postgres`);
    // Generated biomes BEFORE tiles: a tile pools under its biome name, so the biome should exist
    // in the pool first (ordering is cosmetic for tiles, but keeps the load log coherent).
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

// Generate one new monster → add to the pool → persist. Returns the type or null.
// No-op if a generation is already in flight (keeps cost/concurrency bounded).
export async function generateMonster(opts = {}, deps = {}) {
  if (generating) return null;
  generating = true;
  try {
   return await trackGen("monster", async () => {
    const existingNames = new Set(getMonsterTypes().map((m) => m.typeName));
    // Monster generation is the v2 multi-agent pipeline (Idea→Attributes, optionally Model).
    // aiEnabled()-gated; returns a schema-valid MonsterType or null. `deps.createChat` overrides
    // the LangChain client for tests. diversitySeed is a pass-through (TQ-348 removed element seeding).
    const mt = await aiGenerateMonsterV2({ ...diversitySeed(opts), existingNames }, deps);
    if (!mt) return null;
    if (opts.dryRun) return mt; // TQ-213: gen-hub preview — return the generated type WITHOUT pool-add/persist
    if (!addMonsterType(mt)) return null;
    await upsertMonsterType(mt).catch((e) => console.error("[content] persist:", e.message));
    console.log(`[content] generated monster: ${mt.typeName}`);
    return mt;
   });
  } finally {
    generating = false;
  }
}

// Item-variety seed: combat items must be a USEFUL toolkit, not all enemy-debuffs (item.json is
// empty, so AI items are the ONLY source). When the caller gives no `kind`, pick a random role —
// weighted toward self-help (heal/energy/cleanse/buff) plus offence (damage/debuff/status) — so a
// batch covers the range and a player can actually heal mid-fight. An explicit kind is respected.
// Each role carries the AI prompt PLUS the structured model fields it maps to (TQ-64): a category, a
// rarity tier, and a defined effect. The AI still writes the name/flavour from `prompt`; the rest is
// attached deterministically so the item resolves consistently in combat + shows its rarity in the bag.
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
// Returns AI opts with a string `kind` (the prompt) plus `_meta` (the structured fields to tag onto
// the result). An explicit string `kind` (admin override) is respected and gets no structured tag.
export function itemDiversitySeed(opts) {
  if (opts.kind) return opts;
  const k = pickRandom(ITEM_KINDS);
  return { ...opts, kind: k.prompt, _meta: { category: "consumable", rarity: k.rarity, effect: k.effect } };
}

// Generate one AI item and add it to the live pool + persist it (plan "Decide general items").
// aiEnabled()-gated → null when off/failed.
export async function generateItem(opts = {}) {
 return trackGen("item", async () => {
  const pool = getItems();
  const existingNames = new Set(pool.map((it) => it.name));
  const nextId = pool.reduce((m, it) => Math.max(m, Number(it.id) || 0), 0) + 1;
  const seed = itemDiversitySeed(opts);
  const { _meta, ...aiOpts } = seed; // _meta is OUR structured tag, not an AI input
  const it = await aiGenerateItem({ ...aiOpts, existingNames, id: opts.id ?? nextId });
  if (!it) return null;
  // TQ-64: tag the AI item with its structured category/rarity/effect (derived from the role above),
  // unless the model already supplied them. Lets combat apply a consistent effect + the bag show rarity.
  if (_meta) { it.category = it.category || _meta.category; it.rarity = it.rarity || _meta.rarity; it.effect = it.effect || _meta.effect; }
  if (opts.dryRun) return it; // TQ-213: gen-hub preview — return the generated item WITHOUT pool-add/persist
  if (!addItem(it)) return null;
  await upsertItem(it).catch((e) => console.error("[content] item persist:", e.message));
  console.log(`[content] generated item: ${it.name}`);
  return it;
 });
}

// Remove a generated item from the pool + DB (admin curation).
export async function removeGenItem(name) {
  await deleteItem(name).catch(() => false);
  return removeItem(name);
}

// Biome-variety seed: with no `kind`, pick a random environment flavour so repeated clicks make a
// VARIED set of regions instead of all "dark cave" (the small model otherwise converges, like the
// monster/item pipelines). An explicit kind is respected.
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

// All biome names currently in play (built-in baseline + generated pool) — the unique-name set for
// a new biome AND the pool a hint-less tile attaches to.
function allBiomeNames() {
  return [...BIOME_DEFS.map((b) => b.name), ...getBiomes().map((b) => b.name)];
}

// Generate one AI biome → add to the pool → persist. aiEnabled()-gated → null when off/failed.
export async function generateBiome(opts = {}) {
 return trackGen("biome", async () => {
  const existingNames = new Set(allBiomeNames());
  const b = await aiGenerateBiome({ ...biomeDiversitySeed(opts), existingNames });
  if (!b) return null;
  if (opts.dryRun) return b; // TQ-213: gen-hub preview — return the generated biome WITHOUT pool-add/persist
  if (!addBiome(b)) return null;
  await upsertBiome(b).catch((e) => console.error("[content] biome persist:", e.message));
  console.log(`[content] generated biome: ${b.name}`);
  return b;
 });
}

// Remove a generated biome from the pool + DB (admin curation).
export async function removeGenBiome(name) {
  await deleteBiome(name).catch(() => false);
  return removeBiome(name);
}

// Tile-variety seed: a tile belongs to a BIOME (so it pools correctly) and has a surface flavour.
// With no biome given, attach it to a random existing biome (built-in or generated); with no kind,
// pick a random surface so a batch covers different ground types. The kind set is SPLIT by
// collidability so a requested collidable tile is seeded with a solid/boundary surface (water/lava/
// wall/chasm) and a walkable tile with an open floor — the kind reinforces the directive threaded
// through every gen stage. Explicit values are respected.
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
// TQ-150: ORDERING — biomes must exist before their tiles, so a tile pools under a real region.
// gen-batch-biomes.mjs (TQ-158) seeds biomes first, then gen-batch-tiles.mjs (TQ-147) iterates the
// LIVE biome list. With no biome given here we still pick a live biome (never the orphan "Wilds"),
// so connectivity (TQ-83) + biome coupling hold regardless of the caller. Exported for the test.
export function tileDiversitySeed(opts) {
  const out = { ...opts };
  if (!out.biome) { const names = allBiomeNames(); out.biome = names.length ? pickRandom(names) : "Stone"; }
  if (!out.kind) {
    const pool = isSolid(out.collidable) ? TILE_KINDS_SOLID
      : isWalk(out.collidable) ? TILE_KINDS_WALK
      : (Math.random() < 0.33 ? TILE_KINDS_SOLID : TILE_KINDS_WALK); // unspecified → mostly walkable
    out.kind = pickRandom(pool);
  }
  return out;
}

// ── Tile balancing: steer generation so EVERY biome reaches its collidable + non-collidable quota ──
// Per-biome live tile counts split by collidability (counts both seed + generated tiles, matching
// world.js computeGenShortfall, so the targets are measured against the real pool).
function liveBiomeTileCounts() {
  const counts = {};
  for (const t of getGroundTiles()) {
    const b = t.biome || "Wilds";
    (counts[b] ||= { collidable: 0, walk: 0 })[t.collidable ? "collidable" : "walk"]++;
  }
  return counts;
}
// The per-biome targets (4 collidable + 8 walkable, admin-tunable via genConfig).
function tileTargets() {
  const c = roundComposition();
  return { collidable: c.tilesCollidablePerBiome, walk: c.tilesNonCollidablePerBiome };
}
// PURE + exported (unit-tested): of all `biomes`, the (biome, collidable) slot furthest BELOW its
// target — so repeated generation fills every biome's collidable AND walkable quota evenly rather
// than randomly. `opts.biome` / `opts.collidable` pin that axis (only the unspecified side is chosen).
// Ties — and the all-quotas-met case — break via `rand` so it still varies. `counts` is keyed by
// biome → { collidable, walk }; `targets` = { collidable, walk }.
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
  const pool = maxDef > 0 ? cands.filter((c) => c.deficit === maxDef) : cands; // all met → keep variety
  const pick = pool[Math.floor(rand() * pool.length)];
  return { biome: pick.biome, collidable: pick.collidable };
}

// Generate one AI floor tile → add to the pool → persist. aiEnabled()-gated → null when off/failed.
// Assigns the next free id (above the seed ids) so the renderer's per-type sprite cache keys cleanly.
export async function generateTile(opts = {}) {
 return trackGen("tile", async () => {
  const pool = getGroundTiles();
  const existingNames = new Set(pool.map((t) => t.name));
  const nextId = pool.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0) + 1;
  // Steer toward the biome + collidability most short of its target (4 collidable + 8 walkable per
  // biome), so generation keeps EVERY existing biome balanced instead of randomly skewing toward
  // walkable tiles. An explicit opts.biome / opts.collidable is honoured (only the missing side is
  // chosen); `?? ` (nullish) preserves an explicit collidable: 0.
  const target = neediestTileTarget(allBiomeNames(), liveBiomeTileCounts(), tileTargets(), opts);
  const balanced = { ...opts, biome: opts.biome ?? target.biome, collidable: opts.collidable ?? target.collidable };
  const t = await aiGenerateTile({ ...tileDiversitySeed(balanced), existingNames, id: opts.id ?? nextId });
  if (!t) return null;
  if (opts.dryRun) return t; // TQ-213: gen-hub preview — return the generated tile WITHOUT pool-add/persist
  if (!addGroundTile(t)) return null;
  await upsertGroundTile(t).catch((e) => console.error("[content] tile persist:", e.message));
  console.log(`[content] generated floor tile: ${t.name} (${t.biome})`);
  return t;
 });
}

// Remove a generated floor tile from the pool + DB (admin curation).
export async function removeGenTile(name) {
  await deleteGroundTile(name).catch(() => false);
  return removeGroundTile(name);
}

// Remove a generated monster from the pool + DB (admin curation, P7-T3). Only
// affects generated types (deleteMonsterType returns false for hand-authored ones).
export async function removeMonster(name) {
  const wasGenerated = await deleteMonsterType(name).catch(() => false);
  if (wasGenerated) removeMonsterType(name);
  return wasGenerated;
}

// TQ-216: persist a PREVIEWED (dry-run, TQ-213) generation to the live pool on an explicit operator
// action from the gen hub. Each mirrors the save step of its generate* function (add to pool + upsert
// to DB); returns false if the object is invalid or a duplicate name/id (the addX guards). The hub
// never auto-saves — this is the only path a test generation reaches the live pool.
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
