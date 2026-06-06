import { uid } from "./uid.js";

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
  return loadAll().characters;
}

export function getCharacter(id) {
  return loadAll().characters.find((c) => c.id === id);
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
  };
  data.characters.push(character);
  saveAll(data);
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
