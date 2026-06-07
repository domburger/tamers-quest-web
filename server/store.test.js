import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData } from "../src/engine/gamedata.js";
import { GAME } from "../src/engine/schemas.js";
import {
  initStore,
  flushStore,
  shutdownStore,
  createProfile,
  getByToken,
  saveProfile,
  rollStarters,
  profileCount,
  bumpStat,
  topProfiles,
} from "./store.js";

// The store needs monster types to roll starters; feed the engine real data.
function loadData() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"),
    attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"),
    items: read("item.json"),
    spiritChains: read("spiritchains.json"),
  });
}

// These run without DATABASE_URL, so they exercise the pure in-memory path —
// the durable Postgres path is verified by a separate live smoke test.

test("initStore is a no-op (false) without DATABASE_URL", async () => {
  loadData();
  assert.equal(await initStore(), false);
});

test("rollStarters gives up to TEAM_SIZE distinct Lv.1 monsters", () => {
  loadData();
  const team = rollStarters();
  assert.ok(team.length > 0 && team.length <= GAME.TEAM_SIZE);
  assert.ok(team.every((m) => m.level === 1 && m.id && m.typeName));
  assert.equal(new Set(team.map((m) => m.typeName)).size, team.length, "starters should be distinct");
});

test("createProfile + getByToken round-trips an anonymous profile", () => {
  loadData();
  const before = profileCount();
  const p = createProfile("Ash");
  assert.ok(p.token && p.id);
  assert.equal(p.name, "Ash");
  assert.ok(p.activeMonsters.length > 0);
  assert.equal(profileCount(), before + 1);
  assert.equal(getByToken(p.token), p);
});

test("LS-2: the session token is a crypto-random (unguessable) string, and unique", () => {
  loadData();
  const a = createProfile("A");
  const b = createProfile("B");
  assert.match(a.token, /^tk_[0-9a-f]{48}$/); // 24 random bytes as hex — not randomSeed()+counter
  assert.notEqual(a.token, b.token);
});

test("createProfile grants a starter spirit chain; getByToken backfills legacy profiles", () => {
  loadData();
  const p = createProfile("Gary");
  assert.equal(p.equippedChainId, GAME.SPIRIT_CHAIN.STARTER_CHAIN_ID);
  assert.ok(p.chains.length >= 5, "new players start with a ≥5-chain inventory");
  assert.equal(p.chains[0].chainId, GAME.SPIRIT_CHAIN.STARTER_CHAIN_ID);

  // Simulate a profile persisted before the chains field existed.
  delete p.chains;
  p.equippedChainId = null;
  saveProfile(p);
  const got = getByToken(p.token);
  assert.ok(Array.isArray(got.chains) && got.chains.length === 1, "chains backfilled on load");
  assert.equal(got.equippedChainId, GAME.SPIRIT_CHAIN.STARTER_CHAIN_ID);
});

test("getByToken is null-safe for missing/blank tokens", () => {
  assert.equal(getByToken("nope"), null);
  assert.equal(getByToken(null), null);
  assert.equal(getByToken(undefined), null);
  assert.equal(getByToken(""), null);
});

test("saveProfile persists mutations in the cache", () => {
  loadData();
  const p = createProfile("Misty");
  p.name = "Brock";
  p.vaultMonsters = [{ id: "m_x", typeName: "X", level: 3 }];
  saveProfile(p);
  const got = getByToken(p.token);
  assert.equal(got.name, "Brock");
  assert.equal(got.vaultMonsters.length, 1);
});

test("topProfiles ranks by a stat and excludes zeros", () => {
  loadData();
  const a = createProfile("LB-A"); bumpStat(a, "extractions", 5); saveProfile(a);
  const b = createProfile("LB-B"); bumpStat(b, "extractions", 9); saveProfile(b);
  createProfile("LB-C"); // 0 extractions → excluded
  const top = topProfiles("extractions", 10);
  assert.equal(top[0].name, "LB-B");
  assert.equal(top[0].value, 9);
  assert.equal(top[1].name, "LB-A");
  assert.ok(!top.some((e) => e.name === "LB-C"), "zero-stat profile excluded");
});

test("flush/shutdown are safe no-ops without a database", async () => {
  await assert.doesNotReject(flushStore());
  await assert.doesNotReject(shutdownStore());
});
