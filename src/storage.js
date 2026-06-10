import { uid } from "./uid.js";
import { GAME, grantStarterChains, grantStarterInventory } from "./engine/schemas.js";
import { getSpiritChain, getMonsterTypes } from "./engine/gamedata.js";
import { getMonsterStats } from "./engine/stats.js";

/**
 * Roll a fresh starter team (TEAM_SIZE random Lv.1 monsters) for single-player —
 * the SP counterpart to the server's `store.js rollStarters`, injected into the
 * shared `loseRunTeam` (Q10 death stake) and reusable for new-character creation.
 * @returns {Array} fresh active-team instances
 */
export function rollStarters() {
  const all = getMonsterTypes();
  const shuffled = [...all].sort(() => Math.random() - 0.5);
  const team = [];
  for (let i = 0; i < Math.min(GAME.TEAM_SIZE, shuffled.length); i++) {
    const mt = shuffled[i];
    const stats = getMonsterStats(mt, 1);
    team.push({ id: uid(), typeName: mt.typeName, name: mt.typeName, level: 1, xp: 0, currentHealth: stats.health, currentEnergy: stats.energy, status: null });
  }
  return team;
}

const STORAGE_KEY = "tamers_quest_save";

function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    if (!Array.isArray(data.characters)) data.characters = [];
    if (!data.profile) data.profile = null; // { isGuest, nickname } — title identity (FLOW screen 1)
    return data;
  } catch {
    return { characters: [], profile: null };
  }
}

function saveAll(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    // Mirror loadAll's resilience: private-browsing (Safari/Firefox), a blocked-storage setting,
    // or an exceeded quota make setItem THROW even for tiny writes. The read path already degrades
    // to a safe default, but an unguarded write here throws straight out of its caller — e.g. the
    // character-select scene's "Create Character" click handler (createCharacter), wedging the
    // scene (the dialog never closes, the list never re-renders). Degrade to a non-persistent
    // session instead of crashing.
    console.warn("[storage] save failed (storage disabled or full) — continuing without persisting", e);
    return false;
  }
}

// --- Account identity (FLOW screen 1) -------------------------------------
// The title routes through EITHER a login OR "play as guest" → a profile is
// created with an isGuest flag + the chosen nickname, then character select.
// Stored once at the account level (separate from per-character names).

export function getProfile() {
  return loadAll().profile;
}

export function setProfile(profile) {
  const data = loadAll();
  data.profile = profile;
  saveAll(data);
  return profile;
}

// Mark this client as a guest with the given nickname (title "Play as guest").
export function setGuestProfile(nickname) {
  const clean = String(nickname || "").trim().slice(0, 20) || "Guest";
  return setProfile({ isGuest: true, nickname: clean });
}

// Phase 3: guests are SESSION-ONLY — no saved characters. Wipe any persisted guest characters on
// boot so a guest always starts a fresh page session; only logged-in accounts keep saves (cloud).
// A logged-in profile is never touched (its characters come from the server). No-op otherwise.
export function clearGuestCharacters() {
  const data = loadAll();
  if (data.profile && data.profile.isGuest && (data.characters || []).length) {
    data.characters = [];
    saveAll(data);
  }
}

// Mark this client as a LOGGED-IN account (AUTH-T2/T3 — title login buttons). The
// `token` is the server session token (also stored under net's TOKEN_KEY so MP
// resumes this profile); `nickname` is optional (OAuth returns only a token).
export function setAuthedProfile(token, nickname, accountSession) {
  return setProfile({ isGuest: false, token: token || null, nickname: (nickname || "").trim().slice(0, 24) || null, accountSession: accountSession || null });
}

// The account SESSION token (Phase 2 cloud saves) — authorizes the /account/* character CRUD so a
// logged-in client lists/creates/deletes the characters its account owns. null for guests.
export function getAccountSession() {
  const p = loadAll().profile;
  return (p && p.accountSession) || null;
}

// Phase 2: mirror the account's SERVER characters into the local cache so the existing
// character-select + lobby flow (which read getCharacters()/getCharacter() and join with
// character.serverToken) keep working unchanged — the server stays the source of truth
// (re-fetched on each character-select load). Each server character maps to a local slot
// bound by its token. Returns the mirrored list.
export function setServerCharacters(serverChars) {
  const data = loadAll();
  data.characters = (Array.isArray(serverChars) ? serverChars : []).map((c) => ({
    id: c.id || c.token,
    name: c.name || "Tamer",
    level: c.level || 1,
    stats: c.stats || {},
    activeMonsters: c.activeMonsters || [],
    vaultMonsters: [],
    isGuest: false,
    serverToken: c.token, // the lobby joins the run with this token (the authoritative profile)
  }));
  saveAll(data);
  return data.characters;
}

// Sign out: drop the local account/guest identity so the next boot returns to the title as a
// clean slate. The server profile itself stays put (keyed by its token — caller also clears the
// session token via net.clearSession); this just detaches THIS client's identity.
export function clearProfile() {
  const data = loadAll();
  data.profile = null;
  // Also drop the local character mirror. For a logged-in account these are a CACHE of the server
  // characters (re-fetched from /account/characters on re-login, so nothing is lost). Leaving them
  // would let the NEXT person on a shared device — e.g. someone who then plays as a guest, who never
  // re-syncs — see the signed-out account's characters and, via their serverToken, RESUME its server
  // profile. (Boot-time clearGuestCharacters only fires on a page RELOAD, not this in-session
  // sign-out → title → "play as guest" path, which reuses the already-booted game via window.tqGo.)
  data.characters = [];
  saveAll(data);
}

export function isGuest() {
  return !!loadAll().profile?.isGuest;
}

export function getCharacters() {
  return loadAll().characters.map(migrateCharacter);
}

export function getCharacter(id) {
  const c = loadAll().characters.find((c) => c.id === id);
  return c ? migrateCharacter(c) : c;
}

export function createCharacter(name) {
  const data = loadAll();
  const id = uid();
  const character = {
    id,
    name,
    level: 1,
    xp: 0,
    gold: 0,
    // Fresh Lv.1 starter team via the shared roller (the SAME logic the Q10 death-
    // refill uses, and TEAM_SIZE-aware) so a new character is created complete and
    // can't drift from `rollStarters` — was duplicated inline in characterSelect.
    activeMonsters: rollStarters(),
    vaultMonsters: [],
    chains: [],
    equippedChainId: null,
    // Server-authoritative profile binding (SP/MP unify, decision 2026-06-09: the
    // SERVER profile is the single source of truth). Each character slot maps to one
    // token-keyed server profile; null until the lobby first joins and the server
    // mints/returns a token, which we persist here so this slot always resumes the
    // SAME server profile. localStorage stays as a display cache + session binding.
    serverToken: null,
    // Inherit the account identity (FLOW): guest characters are tagged guest so
    // the UI/server can distinguish them from logged-in accounts.
    isGuest: !!data.profile?.isGuest,
  };
  grantStarterInventory(character, getSpiritChain); // new players start with ≥5 chains
  data.characters.push(character);
  saveAll(data);
  return character;
}

// Idempotently backfill the spirit-chain inventory on saves that predate it, so
// loading an old character never leaves the player without a usable chain.
function migrateCharacter(character) {
  if (!character) return character;
  if (!Array.isArray(character.chains) || !character.equippedChainId) {
    grantStarterChains(character, getSpiritChain);
  }
  return character;
}

// Persist the server-profile token this character slot is bound to (SP/MP unify).
// The lobby calls this once, after the server welcomes us and returns a token for a
// freshly-minted profile, so the slot resumes the same authoritative profile forever.
export function setCharacterServerToken(id, token) {
  const data = loadAll();
  const c = data.characters.find((c) => c.id === id);
  if (c && token && c.serverToken !== token) {
    c.serverToken = token;
    saveAll(data);
  }
  return token;
}

export function saveCharacter(character) {
  const data = loadAll();
  const idx = data.characters.findIndex((c) => c.id === character.id);
  if (idx >= 0) {
    data.characters[idx] = character;
  } else {
    data.characters.push(character);
  }
  saveAll(data);
}

export function deleteCharacter(id) {
  const data = loadAll();
  data.characters = data.characters.filter((c) => c.id !== id);
  saveAll(data);
}
