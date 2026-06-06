import { uid } from "./uid.js";
import { grantStarterChains, grantStarterInventory } from "./engine/schemas.js";
import { getSpiritChain } from "./engine/gamedata.js";

const STORAGE_KEY = "tamers_quest_save";

function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { characters: [] };
  } catch {
    return { characters: [] };
  }
}

function saveAll(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
