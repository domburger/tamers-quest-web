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
import { createPlayerProfile, createMonsterInstance, grantStarterChains, grantStarterInventory, ensureChainSlots, GAME } from "../src/engine/schemas.js";
import { getMonsterTypes, getSpiritChain } from "../src/engine/gamedata.js";
import { getMonsterStats } from "../src/engine/stats.js";
import { initDb, dbEnabled, loadAllProfiles, upsertProfiles, closeDb, wipeProfiles, loadAllAccounts, upsertAccounts, wipeAccounts, deleteProfileRow } from "./db.js";

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

// Unguessable short id for ephemeral server objects whose id is sent to clients and used
// to ROUTE incoming actions (PvE combat, PvP duels). Sequential ids ("c1","c2"/"v1","v2")
// let a client enumerate/target another player's combat; a CSPRNG id (72 bits) can't be
// guessed. The participation check is the real gate, but unpredictable ids are defense-in-depth.
export function secureId(prefix) {
  return `${prefix}${randomBytes(9).toString("hex")}`;
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

export function createProfile(nickname, { isGuest = false } = {}) {
  const token = secureToken();
  const profile = createPlayerProfile({ id: rid("pl"), name: nickname, isGuest });
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
  // Backfill the 3-slot chain loadout on profiles persisted before equippedChainIds (2026-06-10).
  if (!Array.isArray(profile.equippedChainIds) || profile.equippedChainIds.length === 0) {
    ensureChainSlots(profile);
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

// AUTH-T2: OAuth account linking. A profile is keyed by its session token; an OAuth
// account is located by its provider id stored on the profile (`googleId`/`discordId`).
// The cache holds every profile (loaded at boot), so a linear scan is fine at this scale.
export function findByOAuth(provider, providerId) {
  if (!provider || !providerId) return null;
  const field = `${provider}Id`;
  for (const p of profiles.values()) if (p[field] === providerId) return p;
  return null;
}

// Link an OAuth identity onto a profile (idempotent). Sets `<provider>Id`, backfills
// email if we don't have one, and clears the guest flag (an OAuth login is a real
// account). Persists. Returns the profile.
export function linkOAuth(profile, provider, providerId, email) {
  if (!profile || !provider || !providerId) return profile;
  profile[`${provider}Id`] = String(providerId);
  if (email && !profile.email) profile.email = email;
  if (profile.isGuest) profile.isGuest = false;
  saveProfile(profile);
  return profile;
}

// AUTH-T3: native email/password accounts. `email` is the account key (normalized
// lowercase by the caller); `passwordHash` marks a profile as a native account.
export function findByEmail(email) {
  if (!email) return null;
  for (const p of profiles.values()) if (p.email === email && p.passwordHash) return p;
  return null;
}

// Create a native account: a normal profile (starters + chains) plus email + hash, and
// not a guest. Caller validates/normalizes email + hashes the password first.
export function createAccount(email, passwordHash, nickname) {
  const profile = createProfile(nickname || "Tamer", { isGuest: false });
  profile.email = email;
  profile.passwordHash = passwordHash;
  saveProfile(profile);
  return profile;
}

// AUTH-T4: claim/migration — let an anonymous player turn THEIR existing profile (held
// by its session token) into a real account, instead of orphaning the save behind a
// fresh one. The token is the holder's own session secret, so claiming is safe; we only
// refuse when it would CLOBBER an existing credential (a profile that's already a native
// account / already linked to that provider) — the caller then falls back to a new account.
export function claimAccount(token, email, passwordHash) {
  const profile = token && profiles.get(token);
  if (!profile || profile.passwordHash) return null; // unknown token, or already a native account
  profile.email = email;
  profile.passwordHash = passwordHash;
  profile.isGuest = false;
  saveProfile(profile);
  return profile;
}

export function claimOAuth(token, provider, providerId, email) {
  const profile = token && profiles.get(token);
  if (!profile || profile[`${provider}Id`]) return null; // unknown token, or already linked to this provider
  return linkOAuth(profile, provider, providerId, email);
}

// ── Accounts (cloud saves, Phase 2) ─────────────────────────────────────────
// An ACCOUNT owns N character profiles. Credentials live on the account (not on a game
// profile), so a logged-in player's characters follow their account across devices. Each
// character is an ordinary token-keyed profile tagged with `ownerAccountId`. Accounts are
// cached + flushed exactly like profiles (a separate dirty set). This is the additive
// FOUNDATION — wiring into auth/world/client lands in follow-ups, so nothing here changes
// existing behaviour yet.
const accounts = new Map(); // sessionToken -> Account
const dirtyAccounts = new Set();

function markAccountDirty(a) {
  if (a && a.sessionToken) { accounts.set(a.sessionToken, a); dirtyAccounts.add(a.sessionToken); }
}

// Create a fresh account — starts EMPTY (no characters; the user creates them — "start fresh per
// account"). Pass exactly one credential kind: {passwordHash} (native) or {googleId}/{discordId}.
export function createAccountRecord({ email = null, passwordHash = null, googleId = null, discordId = null, nickname = "Tamer" } = {}) {
  const a = {
    id: rid("ac"),
    sessionToken: secureToken(),
    email: email ? String(email).toLowerCase() : null,
    passwordHash: passwordHash || null,
    googleId: googleId ? String(googleId) : null,
    discordId: discordId ? String(discordId) : null,
    nickname: String(nickname || "Tamer").slice(0, 24),
    characterTokens: [],
    isAccount: true,
  };
  markAccountDirty(a);
  return a;
}

export function getAccountBySession(sessionToken) {
  return sessionToken ? accounts.get(sessionToken) || null : null;
}

export function findAccountByEmail(email) {
  if (!email) return null;
  const e = String(email).toLowerCase();
  for (const a of accounts.values()) if (a.email === e && a.passwordHash) return a;
  return null;
}

export function findAccountByOAuth(provider, providerId) {
  if (!provider || !providerId) return null;
  const field = `${provider}Id`, id = String(providerId);
  for (const a of accounts.values()) if (a[field] === id) return a;
  return null;
}

// Mint a new character profile OWNED by the account (starters + chains, like createProfile), tag
// it, and add it to the account (capped at maxSlots). Returns the profile, or null when full.
export function accountAddCharacter(account, name, { maxSlots = 5 } = {}) {
  if (!account) return null;
  account.characterTokens = (account.characterTokens || []).filter((t) => profiles.has(t)); // drop dangling
  if (account.characterTokens.length >= maxSlots) return null;
  const profile = createProfile(name || account.nickname || "Tamer", { isGuest: false });
  profile.name = String(name || account.nickname || "Tamer").slice(0, 24);
  profile.ownerAccountId = account.id;
  saveProfile(profile);
  account.characterTokens.push(profile.token);
  markAccountDirty(account);
  return profile;
}

// The account's character profiles (skips dangling tokens), as live profile objects.
export function accountCharacters(account) {
  if (!account) return [];
  return (account.characterTokens || []).map((t) => profiles.get(t)).filter(Boolean);
}

// Remove one character (must belong to the account): drop it from the account + delete the profile.
export function accountRemoveCharacter(account, token) {
  if (!account || !token || !(account.characterTokens || []).includes(token)) return false;
  account.characterTokens = account.characterTokens.filter((t) => t !== token);
  markAccountDirty(account);
  deleteProfile(token);
  return true;
}

// Delete a profile from the cache + DB (used by accountRemoveCharacter).
export function deleteProfile(token) {
  if (!token) return;
  profiles.delete(token);
  dirty.delete(token);
  deleteProfileRow(token).catch((e) => console.error("[store] deleteProfile:", e.message));
}

// Attach an EXISTING profile to an account as one of its characters (migration / guest-claim
// path — does NOT mint a new profile). Tags ownership, names it, clears the guest flag.
// Idempotent on the token. Returns true on success.
export function accountAttachExistingCharacter(account, profile) {
  if (!account || !profile || !profile.token) return false;
  account.characterTokens = account.characterTokens || [];
  if (!account.characterTokens.includes(profile.token)) account.characterTokens.push(profile.token);
  profile.ownerAccountId = account.id;
  if (!profile.name) profile.name = account.nickname || "Tamer";
  if (profile.isGuest) profile.isGuest = false;
  saveProfile(profile);
  markAccountDirty(account);
  return true;
}

// Migrate a LEGACY credentialed profile (the old "1 account = 1 profile" model) into the account
// model: mint an account from its credentials and attach the profile as its FIRST character — so
// an existing player keeps their save (it becomes their first cloud character) instead of being
// orphaned. The credential is left on the profile too (harmless) so a stale old-style lookup still
// resolves during the transition. Returns the new account.
export function migrateProfileToAccount(profile) {
  if (!profile) return null;
  const account = createAccountRecord({
    email: profile.email, passwordHash: profile.passwordHash,
    googleId: profile.googleId, discordId: profile.discordId,
    nickname: profile.name || "Tamer",
  });
  accountAttachExistingCharacter(account, profile);
  return account;
}

export function getAccountById(id) {
  if (!id) return null;
  for (const a of accounts.values()) if (a.id === id) return a;
  return null;
}

// Ensure a profile is wrapped by an account (IDEMPOTENT): return the account that already owns it,
// else migrate the legacy credentialed profile into a fresh account on first use. The auth handlers
// call this so every login/signup yields an account session WITHOUT disturbing the existing token
// flow — an existing player's save simply becomes their account's first cloud character. Never
// throws; returns null only for a nullish profile.
export function ensureAccountForProfile(profile) {
  if (!profile) return null;
  if (profile.ownerAccountId) {
    const existing = getAccountById(profile.ownerAccountId);
    if (existing) return existing;
  }
  // Durable idempotency (not just the in-memory ownerAccountId): if an account already exists for
  // this credential — e.g. the profile's first migration flush was lost on a restart but the
  // account's flush landed — re-attach instead of minting a DUPLICATE account for one identity.
  const existing =
    (profile.email && findAccountByEmail(profile.email)) ||
    (profile.googleId && findAccountByOAuth("google", profile.googleId)) ||
    (profile.discordId && findAccountByOAuth("discord", profile.discordId));
  if (existing) { accountAttachExistingCharacter(existing, profile); return existing; }
  return migrateProfileToAccount(profile);
}

export function accountCount() {
  return accounts.size;
}

// Test/introspection helper.
export function profileCount() {
  return profiles.size;
}

// Admin "clean wipe": drop ALL player data — the in-memory cache, the dirty set (so the
// flush loop can't resurrect a just-cleared profile), and the DB rows. Destructive +
// irreversible. A player who reconnects with an old token afterward simply gets a fresh
// profile (getByToken misses → the join handler mints a new one), i.e. a true clean slate.
export async function wipeAllProfiles() {
  const n = profiles.size;
  profiles.clear();
  dirty.clear();
  accounts.clear();
  dirtyAccounts.clear();
  await wipeProfiles().catch((e) => console.error("[store] wipe:", e.message));
  await wipeAccounts().catch((e) => console.error("[store] wipe accounts:", e.message));
  return n;
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
  const accts = await loadAllAccounts();
  for (const { sessionToken, data } of accts) accounts.set(sessionToken, data);
  console.log(`[store] persistence ON — loaded ${rows.length} profile(s) + ${accts.length} account(s) from Postgres`);
  flushTimer = setInterval(() => {
    flushStore().catch((e) => console.error("[store] flush:", e.message));
  }, FLUSH_MS);
  flushTimer.unref?.(); // don't keep the process alive just for the timer
  return true;
}

// Write all dirty profiles' + accounts' current state to the DB (coalesced, order-independent).
export async function flushStore() {
  if (!dbEnabled() || (dirty.size === 0 && dirtyAccounts.size === 0)) return;
  // Profiles
  if (dirty.size > 0) {
    const batch = [];
    for (const token of dirty) { const p = profiles.get(token); if (p) batch.push(p); }
    dirty.clear();
    try {
      await upsertProfiles(batch);
    } catch (e) {
      for (const p of batch) dirty.add(p.token); // re-queue for the next flush
      throw e;
    }
  }
  // Accounts (cloud saves) — same coalesced last-write-wins pattern.
  if (dirtyAccounts.size > 0) {
    const abatch = [];
    for (const tk of dirtyAccounts) { const a = accounts.get(tk); if (a) abatch.push(a); }
    dirtyAccounts.clear();
    try {
      await upsertAccounts(abatch);
    } catch (e) {
      for (const a of abatch) dirtyAccounts.add(a.sessionToken); // re-queue
      throw e;
    }
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
