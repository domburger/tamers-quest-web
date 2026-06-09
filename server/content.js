// AI content pipeline (P5). Bridges the generator (gen.js) to the live monster
// pool (engine/gamedata) and durable storage (db.js):
//   initContent()      — load previously-generated monster types into the pool at boot
//   generateMonster()  — make one new monster, add it to the pool, and persist it
//
// Generation makes a live OpenAI call (cost), so it's invoked only when enabled
// (MONSTER_GEN_RATE > 0, wired in world.js). Loading + serving the pool is free.

import { addMonsterType, removeMonsterType, getMonsterTypes, addItem, removeItem, getItems } from "../src/engine/gamedata.js";
import { aiGenerateItem } from "./genItems.js";
import { dbEnabled, loadMonsterTypes, upsertMonsterType, deleteMonsterType, loadItems, upsertItem, deleteItem } from "./db.js";
import { aiGenerateMonsterV2 } from "./genStages.js"; // multi-agent pipeline (Idea→Attributes[→Model])
import { BODY_SHAPES } from "../src/systems/monsterModel.js";

let generating = false; // simple guard against overlapping generations

// Diversity seed for hint-less generation. With a small model the Idea agent otherwise
// converges on ONE concept (every monster comes out a near-identical "gloom-maw cave saurian")
// because the prompts' "dark cave world" framing dominates. Both callers — in-game spawns
// (world.js) and the admin "generate" button — pass no hints, so when neither element nor
// biome is given we pick a random coherent THEME ({element + biome} spanning the element wheel)
// plus a random silhouette, making a batch read as a varied (but still grim) menagerie. The
// element/biome flow into the prompts via hintLine, where the element line is authoritative.
// An explicit element/biome (a targeted spawn) is always respected and never overridden.
const GEN_THEMES = [
  { element: "Fire", biome: "molten cavern" },
  { element: "Water", biome: "drowned trench" },
  { element: "Nature", biome: "fungal hollow" },
  { element: "Ice", biome: "frozen vault" },
  { element: "Electric", biome: "storm-wracked spire" },
  { element: "Earth", biome: "collapsed mine" },
  { element: "Poison", biome: "toxic mire" },
  { element: "Dark", biome: "lightless abyss" },
  { element: "Light", biome: "sunscarred ruin" },
  { element: "Metal", biome: "rusted foundry" },
  { element: "Arcane", biome: "shattered sanctum" },
  { element: "Air", biome: "windswept crag" },
];
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
function diversitySeed(opts) {
  if (opts.element || opts.biome) return opts; // caller targeted it — respect it
  const theme = pickRandom(GEN_THEMES);
  return { ...opts, element: theme.element, biome: theme.biome, archetype: pickRandom(BODY_SHAPES) };
}

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
    const existingNames = new Set(getMonsterTypes().map((m) => m.typeName));
    // Monster generation is the v2 multi-agent pipeline (Idea→Attributes, optionally Model).
    // aiEnabled()-gated; returns a schema-valid MonsterType or null. `deps.createChat` overrides
    // the LangChain client for tests. diversitySeed spreads hint-less batches across elements.
    const mt = await aiGenerateMonsterV2({ ...diversitySeed(opts), existingNames }, deps);
    if (!mt || !addMonsterType(mt)) return null;
    await upsertMonsterType(mt).catch((e) => console.error("[content] persist:", e.message));
    console.log(`[content] generated monster: ${mt.typeName} (${mt.element})`);
    return mt;
  } finally {
    generating = false;
  }
}

// Item-variety seed: combat items must be a USEFUL toolkit, not all enemy-debuffs (item.json is
// empty, so AI items are the ONLY source). When the caller gives no `kind`, pick a random role —
// weighted toward self-help (heal/energy/cleanse/buff) plus offence (damage/debuff/status) — so a
// batch covers the range and a player can actually heal mid-fight. An explicit kind is respected.
const ITEM_KINDS = [
  "a HEALING potion that restores a good chunk of the USER's own monster's health",
  "a HEALING salve that restores some of the USER's own monster's health",
  "an ENERGY draught that restores the USER's own monster's energy",
  "a CLEANSING remedy that cures the USER's own monster's status ailment (burn/poison/freeze/etc.)",
  "a GUARD charm that raises the USER's own monster's defense or power for a few turns",
  "a SWIFT tonic that raises the USER's own monster's speed or accuracy for a few turns",
  "an offensive BOMB that deals direct damage to the ENEMY monster",
  "a SNARE that weakens or hinders the ENEMY monster (lowers a stat or slows it)",
  "a TOXIN that inflicts burn, poison, or freeze on the ENEMY monster",
];
function itemDiversitySeed(opts) {
  return opts.kind ? opts : { ...opts, kind: pickRandom(ITEM_KINDS) };
}

// Generate one AI item and add it to the live pool + persist it (plan "Decide general items").
// aiEnabled()-gated → null when off/failed.
export async function generateItem(opts = {}) {
  const pool = getItems();
  const existingNames = new Set(pool.map((it) => it.name));
  const nextId = pool.reduce((m, it) => Math.max(m, Number(it.id) || 0), 0) + 1;
  const it = await aiGenerateItem({ ...itemDiversitySeed(opts), existingNames, id: opts.id ?? nextId });
  if (!it || !addItem(it)) return null;
  await upsertItem(it).catch((e) => console.error("[content] item persist:", e.message));
  console.log(`[content] generated item: ${it.name}`);
  return it;
}

// Remove a generated item from the pool + DB (admin curation).
export async function removeGenItem(name) {
  await deleteItem(name).catch(() => false);
  return removeItem(name);
}

// Remove a generated monster from the pool + DB (admin curation, P7-T3). Only
// affects generated types (deleteMonsterType returns false for hand-authored ones).
export async function removeMonster(name) {
  const wasGenerated = await deleteMonsterType(name).catch(() => false);
  if (wasGenerated) removeMonsterType(name);
  return wasGenerated;
}
