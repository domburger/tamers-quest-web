import { uid } from "./uid.js";
import { grantStarterChains, grantStarterInventory } from "./engine/schemas.js";
import { getSpiritChain } from "./engine/gamedata.js";

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
    activeMonsters: [],
    vaultMonsters: [],
    chains: [],
    equippedChainId: null,
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
