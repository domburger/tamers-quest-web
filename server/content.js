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
import { aiGenerateMonster } from "./gen.js";
import { aiGenerateMonsterV2 } from "./genStages.js"; // P5-T4 multi-agent pipeline (opt-in)
import { getAiConfig } from "./aiconfig.js"; // admin-tunable gen pipeline toggle

let generating = false; // simple guard against overlapping generations

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
export async function generateMonster(opts = {}) {
  if (generating) return null;
  generating = true;
  try {
    const existingNames = new Set(getMonsterTypes().map((m) => m.typeName));
    // P5-T4: opt into the multi-agent (Idea→Attributes) pipeline via /admin (genPipeline=v2)
    // or MONSTER_GEN_PIPELINE=v2 — either source enables it; default = the single-call
    // generator (unchanged behavior). Both are aiEnabled()-gated + return a schema-valid
    // MonsterType|null, so the rest of this flow is identical.
    const useV2 = getAiConfig("genPipeline") === "v2" || process.env.MONSTER_GEN_PIPELINE === "v2";
    const mt = await (useV2 ? aiGenerateMonsterV2 : aiGenerateMonster)({ ...opts, existingNames });
    if (!mt || !addMonsterType(mt)) return null;
    await upsertMonsterType(mt).catch((e) => console.error("[content] persist:", e.message));
    console.log(`[content] generated monster: ${mt.typeName} (${mt.element})`);
    return mt;
  } finally {
    generating = false;
  }
}

// Generate one AI item and add it to the live pool (plan "Decide general items"). In-memory
// for now (DB persistence for items is a follow-on); aiEnabled()-gated → null when off/failed.
export async function generateItem(opts = {}) {
  const pool = getItems();
  const existingNames = new Set(pool.map((it) => it.name));
  const nextId = pool.reduce((m, it) => Math.max(m, Number(it.id) || 0), 0) + 1;
  const it = await aiGenerateItem({ ...opts, existingNames, id: opts.id ?? nextId });
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
