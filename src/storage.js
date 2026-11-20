import { uid } from "./uid.js";
import { GAME, grantStarterChains, grantStarterInventory } from "./engine/schemas.js";
import { getSpiritChain, getMonsterTypes } from "./engine/gamedata.js";
import { getMonsterStats } from "./engine/stats.js";

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
    if (!data.profile) data.profile = null;
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
    // setItem can throw (private mode/quota): never let it escape
    console.warn("[storage] save failed (storage disabled or full) — continuing without persisting", e);
    return false;
  }
}

export function getProfile() {
  return loadAll().profile;
}

export function setProfile(profile) {
  const data = loadAll();
  data.profile = profile;
  saveAll(data);
  return profile;
}

export function setGuestProfile(nickname) {
  const clean = String(nickname || "").trim().slice(0, 20) || "Guest";
  return setProfile({ isGuest: true, nickname: clean });
}

export function clearGuestCharacters() {
  const data = loadAll();
  if (data.profile && data.profile.isGuest && (data.characters || []).length) {
    data.characters = [];
    saveAll(data);
  }
}

export function setAuthedProfile(token, nickname, accountSession, remember = true) {
  // Clear cached characters on login or guest/previous-account chars leak in
  const data = loadAll();
  data.characters = [];
  data.profile = { isGuest: false, token: token || null, nickname: (nickname || "").trim().slice(0, 24) || null, accountSession: accountSession || null, remember: remember !== false };
  saveAll(data);
  return data.profile;
}

const SESSION_SENTINEL = "tq_session_alive";

export function markSession(remember) {
  try {
    if (remember === false) sessionStorage.setItem(SESSION_SENTINEL, "1");
    else sessionStorage.removeItem(SESSION_SENTINEL);
  } catch {}
}

// Call at boot BEFORE the stay-signed-in auto-skip
export function resolveSessionPersistence() {
  const data = loadAll();
  const p = data.profile;
  if (!p || p.isGuest || p.remember !== false) return;
  let alive = false;
  try { alive = !!sessionStorage.getItem(SESSION_SENTINEL); } catch { alive = false; }
  if (!alive) { data.profile = null; data.characters = []; saveAll(data); }
}

export function setProfileNickname(nickname) {
  const data = loadAll();
  if (!data.profile) return null;
  const clean = String(nickname || "").trim().slice(0, 24);
  if (!clean) return data.profile.nickname || null;
  data.profile.nickname = clean;
  saveAll(data);
  return clean;
}

export function getAccountNickname() {
  const p = loadAll().profile;
  return (p && p.nickname) || null;
}

export function getAccountSession() {
  const p = loadAll().profile;
  return (p && p.accountSession) || null;
}

export function setServerCharacters(serverChars) {
  const data = loadAll();
  data.characters = (Array.isArray(serverChars) ? serverChars : []).map((c) => ({
    id: c.id || c.token,
    name: c.name || "Tamer",
    level: c.level || 1,
    gold: c.gold || 0,
    stats: c.stats || {},
    activeMonsters: c.activeMonsters || [],
    vaultMonsters: [],
    isGuest: false,
    serverToken: c.token,
  }));
  saveAll(data);
  return data.characters;
}

export function clearProfile() {
  const data = loadAll();
  data.profile = null;
  // Must clear: cached serverTokens would let the next user resume this account
  data.characters = [];
  saveAll(data);
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
    activeMonsters: rollStarters(),
    vaultMonsters: [],
    chains: [],
    equippedChainId: null,
    serverToken: null,
    isGuest: !!data.profile?.isGuest,
  };
  grantStarterInventory(character, getSpiritChain);
  data.characters.push(character);
  saveAll(data);
  return character;
}

function migrateCharacter(character) {
  if (!character) return character;
  if (!Array.isArray(character.chains) || !character.equippedChainId) {
    grantStarterChains(character, getSpiritChain);
  }
  return character;
}

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
