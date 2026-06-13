// rollStarters is the single source for a new character's team AND the Q10 death
// refill (createCharacter + loseRunTeam both use it). It's pure (game data only, no
// localStorage), so it's testable directly once the shared gamedata cache is loaded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterType } from "./engine/gamedata.js";
import { getMonsterStats } from "./engine/stats.js";
import { GAME } from "./engine/schemas.js";
import { rollStarters, createCharacter, setProfile, setAuthedProfile, getCharacters, clearGuestCharacters, clearProfile, setServerCharacters } from "./storage.js";

function load() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"), attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"), items: read("item.json"),
    spiritChains: read("spiritchains.json"),
  });
}

test("rollStarters returns a full TEAM_SIZE team of valid Lv.1 instances", () => {
  load();
  const team = rollStarters();
  assert.equal(team.length, GAME.TEAM_SIZE, "team is TEAM_SIZE (not a hardcoded count)");
  for (const m of team) {
    assert.ok(m.id, "each starter has a unique id");
    assert.ok(getMonsterType(m.typeName), "typeName resolves to a real monster type");
    assert.equal(m.level, 1, "starters are Lv.1");
    const st = getMonsterStats(getMonsterType(m.typeName), 1);
    assert.equal(m.currentHealth, st.health, "spawns at full HP");
    assert.equal(m.currentEnergy, st.energy, "spawns at full energy");
    assert.equal(m.status, null);
  }
  // Fresh ids each roll (no shared references between a new char and a refill).
  const ids = new Set(team.map((m) => m.id));
  assert.equal(ids.size, team.length, "ids are unique within a roll");
  assert.notEqual(rollStarters()[0].id, team[0].id, "a second roll yields fresh ids");
});

test("clearGuestCharacters: wipes a guest's characters (session-only), leaves a logged-in account's", () => {
  const orig = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  try {
    const K = "tamers_quest_save";
    // A guest with characters → wiped (Phase 3: guests are session-only).
    store.set(K, JSON.stringify({ profile: { isGuest: true, nickname: "G" }, characters: [{ id: "a" }, { id: "b" }] }));
    clearGuestCharacters();
    assert.deepEqual(JSON.parse(store.get(K)).characters, [], "guest characters wiped on boot");
    // A logged-in account with characters → untouched (its saves are server-backed / kept).
    store.set(K, JSON.stringify({ profile: { isGuest: false, token: "tk_x" }, characters: [{ id: "c" }] }));
    clearGuestCharacters();
    assert.equal(JSON.parse(store.get(K)).characters.length, 1, "logged-in characters are NOT wiped");
  } finally {
    if (orig === undefined) delete globalThis.localStorage; else globalThis.localStorage = orig;
  }
});

test("clearProfile (sign out): drops the identity AND the cloud-character mirror (no shared-device leak)", () => {
  const orig = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  try {
    const K = "tamers_quest_save";
    // A signed-in account whose cloud characters were mirrored locally (each carries a serverToken).
    store.set(K, JSON.stringify({ profile: { isGuest: false, token: "tk_a", accountSession: "as_a" },
      characters: [{ id: "c1", serverToken: "tk_a_c1" }, { id: "c2", serverToken: "tk_a_c2" }] }));
    clearProfile();
    const after = JSON.parse(store.get(K));
    assert.equal(after.profile, null, "identity detached");
    // The mirror MUST be gone: otherwise the next person (e.g. a guest, who never re-syncs) could see
    // and — via the serverToken — RESUME the signed-out account's characters on a shared device.
    assert.deepEqual(after.characters, [], "the account's local character mirror is dropped on sign-out");
  } finally {
    if (orig === undefined) delete globalThis.localStorage; else globalThis.localStorage = orig;
  }
});

test("setServerCharacters: maps the server's per-character gold (TQ-102 — panel showed 0)", () => {
  const orig = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  try {
    // The server's serializeCharacter sends per-character gold; setServerCharacters used to drop it,
    // so the character-select stats panel always read sc.gold === undefined → 0.
    const chars = setServerCharacters([{ token: "tk1", id: "c1", name: "Burgi", level: 3, gold: 123, stats: { runs: 2 }, activeMonsters: [{ typeName: "X" }] }]);
    assert.equal(chars[0].gold, 123, "the server's gold is preserved on the mapped character");
    assert.equal(getCharacters()[0].gold, 123, "and it persists to the stored character mirror");
    // Absent gold defaults to 0 (no NaN/undefined leaking into the panel).
    assert.equal(setServerCharacters([{ token: "tk2", id: "c2", name: "NoGold" }])[0].gold, 0, "absent gold defaults to 0");
  } finally {
    if (orig === undefined) delete globalThis.localStorage; else globalThis.localStorage = orig;
  }
});

test("setAuthedProfile (login): clears leftover local characters so a fresh account isn't pre-seeded", () => {
  const orig = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  try {
    const K = "tamers_quest_save";
    // A guest played first (their local starter team) and then creates a real account on the
    // same device. Logging in MUST drop the leftover guest character — a logged-in account's
    // characters are server-authoritative — else a brand-new (empty) account "already has a
    // character" (the bug: the guest starter survived guest→account + the transient-empty guard).
    store.set(K, JSON.stringify({ profile: { isGuest: true, nickname: "G" }, characters: [{ id: "g1", serverToken: null }] }));
    setAuthedProfile("tk_new", "Newbie", "as_new", true);
    const after = JSON.parse(store.get(K));
    assert.equal(after.profile.isGuest, false, "now a logged-in account");
    assert.equal(after.profile.accountSession, "as_new", "account session stored");
    assert.deepEqual(after.characters, [], "leftover local characters cleared at login");
    assert.deepEqual(getCharacters(), [], "getCharacters() is empty for the fresh account");
  } finally {
    if (orig === undefined) delete globalThis.localStorage; else globalThis.localStorage = orig;
  }
});

test("saveAll degrades gracefully when localStorage.setItem throws (private mode / quota)", () => {
  // loadAll already try/catches reads; saveAll must mirror it. Otherwise a guest in private-
  // browsing (where setItem throws) crashes the character-select click handler instead of just
  // failing to persist. Simulate a blocked store: getItem works, setItem throws.
  load(); // createCharacter -> rollStarters needs game data
  const orig = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => {} };
  try {
    assert.doesNotThrow(() => setProfile({ isGuest: true, nickname: "Priv" }), "setProfile must not throw when the write is blocked");
    let char;
    assert.doesNotThrow(() => { char = createCharacter("Priv"); }, "createCharacter must not throw when the write is blocked");
    assert.ok(char && char.name === "Priv" && char.activeMonsters.length, "the character is still returned (usable this session, just not persisted)");
  } finally {
    if (orig === undefined) delete globalThis.localStorage; else globalThis.localStorage = orig;
  }
});
