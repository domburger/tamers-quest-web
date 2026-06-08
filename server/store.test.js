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
  createAccount,
  findByEmail,
  findByOAuth,
  linkOAuth,
  claimOAuth,
  claimAccount,
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

test("createAccount + findByEmail: native-account round-trip; passwordless (guest) profiles are not matched", () => {
  loadData();
  const acct = createAccount("ada@example.com", "hash#1", "Ada");
  assert.equal(acct.isGuest, false, "a native account is not a guest");
  assert.equal(acct.email, "ada@example.com");
  assert.equal(acct.passwordHash, "hash#1");
  assert.ok(Array.isArray(acct.activeMonsters) && acct.activeMonsters.length > 0, "starters were rolled");

  // Found by email...
  assert.equal(findByEmail("ada@example.com"), acct, "round-trips by email");
  // ...but ONLY because it has a passwordHash — a guest with an email is not a native account.
  const guest = createProfile("Guesty", { isGuest: true });
  guest.email = "guest@example.com"; // email but no passwordHash
  saveProfile(guest);
  assert.equal(findByEmail("guest@example.com"), null, "a passwordless (guest) profile is not matched as an account");
  // unknown / nullish email → null (never throws)
  assert.equal(findByEmail("nobody@example.com"), null);
  assert.equal(findByEmail(null), null);
  assert.equal(findByEmail(""), null);
});

test("OAuth + account linking (store): link/claim flows and their one-time guards", () => {
  loadData();
  // linkOAuth: a guest gains a provider id, loses guest status, backfills email; findByOAuth locates it.
  const g1 = createProfile("Linker", { isGuest: true });
  linkOAuth(g1, "google", 12345, "ada@oauth.com");
  assert.equal(g1.googleId, "12345", "provider id stored as a string");
  assert.equal(g1.isGuest, false, "linking promotes a guest to an account");
  assert.equal(g1.email, "ada@oauth.com", "email backfilled when absent");
  assert.equal(findByOAuth("google", "12345"), g1, "found by provider id");
  assert.equal(findByOAuth("google", null), null);
  assert.equal(findByOAuth(null, "x"), null);
  assert.equal(findByOAuth("google", "nope"), null);

  // claimOAuth: claim a guest token for an OAuth login; refuses a re-claim of the same provider (no hijack).
  const g2 = createProfile("Claimer", { isGuest: true });
  assert.equal(claimOAuth(g2.token, "discord", 999, null), g2);
  assert.equal(g2.discordId, "999");
  assert.equal(g2.isGuest, false);
  assert.equal(claimOAuth(g2.token, "discord", 1000, null), null, "already linked to discord → no re-link");
  assert.equal(claimOAuth("bad-token", "google", 1, null), null, "unknown token → null");

  // claimAccount: claim a guest token for a native account; refuses if it's already a native account.
  const g3 = createProfile("Native", { isGuest: true });
  assert.equal(claimAccount(g3.token, "n@e.com", "pw#hash"), g3);
  assert.equal(g3.passwordHash, "pw#hash");
  assert.equal(g3.isGuest, false);
  assert.equal(claimAccount(g3.token, "other@e.com", "pw#2"), null, "already a native account → not overwritten");
  assert.equal(claimAccount("bad-token", "x@e.com", "h"), null);
});
