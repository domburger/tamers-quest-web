// Profile store — the persistence seam (P1-T2). The in-memory Map is the live
// read cache so the hot path (getByToken / createProfile in the join handler)
// stays synchronous and message ordering is preserved. Durability is layered on:
// at boot we load every profile from Postgres into the cache; on change we mark
// the token dirty and a coalescing flush loop writes the *current* state back
// (order-independent, last-write-wins) — plus a final flush on shutdown so a
// graceful redeploy (Railway SIGTERM) loses nothing.
//
// Without DATABASE_URL the DB layer is inert and this is a pure in-memory store
// (local dev, tests) — identical behaviour to before P1-T2, just non-durable.
//
// Anonymous players (decision Q6) get an opaque session token on first join; the
// client stores it and presents it on reconnect to resume the same profile.

import { randomBytes } from "node:crypto";
import { randomSeed } from "../src/engine/rng.js";
import { createPlayerProfile, createMonsterInstance, grantStarterChains, grantStarterInventory, GAME } from "../src/engine/schemas.js";
import { getMonsterTypes, getSpiritChain } from "../src/engine/gamedata.js";
import { getMonsterStats } from "../src/engine/stats.js";
import { initDb, dbEnabled, loadAllProfiles, upsertProfiles, closeDb } from "./db.js";

const profiles = new Map(); // token -> PlayerProfile (with a .token field) — live read cache
const dirty = new Set(); // tokens with unflushed changes
const FLUSH_MS = 3000;
let counter = 1;
let flushTimer = null;

// Opaque, non-cryptographic id (uniqueness only). Fine for monster/profile ids.
function rid(prefix) {
  return `${prefix}_${randomSeed().toString(36)}${(counter++).toString(36)}`;
}

// LS-2: the session token authenticates an anonymous player (token → profile), so
// it must be UNGUESSABLE — `rid()`'s randomSeed()+counter is predictable, which
// would let an attacker guess another player's token (account takeover). Mint it
// from a CSPRNG instead (192 bits). `rid()` stays for non-security uniqueness ids.
function secureToken() {
  return `tk_${randomBytes(24).toString("hex")}`;
}

// Globally-unique monster instance id. Use for every monster created at runtime
// (caught/looted/rolled) so ids never collide across profiles or server restarts
// — dedup-by-id (applyRoster) would otherwise silently drop a duplicate.
export function newMonsterId() {
  return rid("m");
}

// Roll a fresh base inventory: up to TEAM_SIZE distinct random Lv.1 starters.
// Server-authoritative (mirrors the old client-side character creation).
export function rollStarters() {
  const types = getMonsterTypes();
  const team = [];
  const used = new Set();
  let guard = 0;
  while (team.length < Math.min(GAME.TEAM_SIZE, types.length) && guard++ < 200) {
    const mt = types[Math.floor(Math.random() * types.length)];
    if (used.has(mt.typeName)) continue;
    used.add(mt.typeName);
    team.push(
      createMonsterInstance({
        typeName: mt.typeName,
        level: 1,
        stats: getMonsterStats(mt, 1),
        id: rid("m"),
      })
    );
  }
  return team;
}

export function createProfile(nickname) {
  const token = secureToken();
  const profile = createPlayerProfile({ id: rid("pl"), name: nickname });
  profile.activeMonsters = rollStarters();
  grantStarterInventory(profile, getSpiritChain); // new players start with ≥5 chains
  profile.token = token;
  profiles.set(token, profile);
  dirty.add(token);
  return profile;
}

export function getByToken(token) {
  if (!token) return null;
  const profile = profiles.get(token);
  if (!profile) return null;
  // Backfill the chain inventory on profiles persisted before the chains field.
  if (!Array.isArray(profile.chains) || !profile.equippedChainId) {
    grantStarterChains(profile, getSpiritChain);
    dirty.add(token);
  }
  return profile;
}

export function saveProfile(profile) {
  if (profile && profile.token) {
    profiles.set(profile.token, profile);
    dirty.add(profile.token);
  }
}

// Test/introspection helper.
export function profileCount() {
  return profiles.size;
}

// Increment a lifetime stat counter on a profile (P8-T1). Defaults the stats map
// for profiles created before stats existed. Caller persists via saveProfile.
export function bumpStat(profile, key, n = 1) {
  if (!profile) return;
  profile.stats = profile.stats || {};
  profile.stats[key] = (profile.stats[key] || 0) + n;
}

// Top profiles by a stat, for the leaderboard (P8-T4). Ranks the in-memory cache
// (all profiles are loaded at boot), excludes zeros.
export function topProfiles(stat, n = 10) {
  return [...profiles.values()]
    .map((p) => ({ name: p.name, value: (p.stats && p.stats[stat]) || 0 }))
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

// --- persistence lifecycle (P1-T2) ---

// Load durable profiles into the cache and start the write-back loop. Pure
// in-memory no-op (returns false) when DATABASE_URL is unset — local dev, tests.
export async function initStore() {
  const enabled = await initDb();
  if (!enabled) {
    console.log("[store] no DATABASE_URL — profiles are in-memory only (reset on redeploy)");
    return false;
  }
  const rows = await loadAllProfiles();
  for (const { token, data } of rows) profiles.set(token, data);
  console.log(`[store] persistence ON — loaded ${rows.length} profile(s) from Postgres`);
  flushTimer = setInterval(() => {
    flushStore().catch((e) => console.error("[store] flush:", e.message));
  }, FLUSH_MS);
  flushTimer.unref?.(); // don't keep the process alive just for the timer
  return true;
}

// Write all dirty profiles' current state to the DB (coalesced, order-independent).
export async function flushStore() {
  if (!dbEnabled() || dirty.size === 0) return;
  const batch = [];
  for (const token of dirty) {
    const p = profiles.get(token);
    if (p) batch.push(p);
  }
  dirty.clear();
  try {
    await upsertProfiles(batch);
  } catch (e) {
    for (const p of batch) dirty.add(p.token); // re-queue for the next flush
    throw e;
  }
}

// Graceful shutdown: stop the loop, flush once more, close the pool.
export async function shutdownStore() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  try {
    await flushStore();
  } catch (e) {
    console.error("[store] final flush:", e.message);
  }
  await closeDb();
}
