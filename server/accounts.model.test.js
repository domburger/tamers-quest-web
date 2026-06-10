import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData } from "../src/engine/gamedata.js";
import {
  createAccountRecord, getAccountBySession, findAccountByEmail, findAccountByOAuth,
  accountAddCharacter, accountCharacters, accountRemoveCharacter, getByToken, accountCount,
} from "./store.js";

// The account model is the Phase-2 cloud-save foundation: an account OWNS N character profiles,
// credentials live on the account (not a game profile), so a logged-in player's characters follow
// the account across devices. Pure in-memory here (no DATABASE_URL). accountAddCharacter rolls
// starters, so the engine needs real monster data.
function loadData() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"), attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"), items: read("item.json"), spiritChains: read("spiritchains.json"),
  });
}

test("createAccountRecord: a fresh account starts EMPTY (no characters) with an unguessable session token", () => {
  const a = createAccountRecord({ email: "Test@Example.COM", passwordHash: "scrypt$x$y", nickname: "Tess" });
  assert.match(a.sessionToken, /^tk_[0-9a-f]{48}$/, "CSPRNG session token");
  assert.equal(a.email, "test@example.com", "email normalized to lowercase");
  assert.equal(a.passwordHash, "scrypt$x$y");
  assert.deepEqual(a.characterTokens, [], "no characters — start fresh per account");
  assert.equal(a.isAccount, true);
  assert.equal(getAccountBySession(a.sessionToken), a, "resolvable by session token");
});

test("findAccountByEmail / findAccountByOAuth locate the account; missing → null", () => {
  const a = createAccountRecord({ email: "mail@x.io", passwordHash: "h" });
  const g = createAccountRecord({ googleId: "g-123", nickname: "G" });
  assert.equal(findAccountByEmail("MAIL@X.IO"), a, "case-insensitive email lookup");
  assert.equal(findAccountByEmail("nobody@x.io"), null);
  assert.equal(findAccountByOAuth("google", "g-123"), g);
  assert.equal(findAccountByOAuth("discord", "g-123"), null, "wrong provider → null");
  assert.equal(findAccountByEmail("mail@x.io")?.passwordHash, "h");
});

test("accountAddCharacter: mints an owned character profile, added to the account + resolvable by token", () => {
  loadData();
  const a = createAccountRecord({ email: "c@x.io", passwordHash: "h", nickname: "Cee" });
  const p = accountAddCharacter(a, "Hero");
  assert.ok(p && p.token, "returns a character profile with a token");
  assert.equal(p.name, "Hero");
  assert.equal(p.ownerAccountId, a.id, "tagged with the owning account");
  assert.equal(p.isGuest, false);
  assert.ok(p.activeMonsters.length > 0, "rolled a starter team");
  assert.deepEqual(a.characterTokens, [p.token], "added to the account");
  assert.equal(getByToken(p.token), p, "playable: resolvable by its token (lobby join path)");
  assert.equal(accountCharacters(a).length, 1);
});

test("accountAddCharacter caps the slot count (default 5)", () => {
  loadData();
  const a = createAccountRecord({ email: "full@x.io", passwordHash: "h" });
  for (let i = 0; i < 5; i++) assert.ok(accountAddCharacter(a, `C${i}`), `slot ${i} created`);
  assert.equal(accountAddCharacter(a, "Overflow"), null, "6th character refused (capped)");
  assert.equal(a.characterTokens.length, 5);
});

test("accountRemoveCharacter: only an OWNED token is removed + its profile deleted", () => {
  loadData();
  const a = createAccountRecord({ email: "r@x.io", passwordHash: "h" });
  const other = createAccountRecord({ email: "other@x.io", passwordHash: "h" });
  const p = accountAddCharacter(a, "Doomed");
  const op = accountAddCharacter(other, "Safe");
  assert.equal(accountRemoveCharacter(a, op.token), false, "can't delete another account's character");
  assert.ok(getByToken(op.token), "the other account's character is untouched");
  assert.equal(accountRemoveCharacter(a, p.token), true, "owned character removed");
  assert.equal(getByToken(p.token), null, "its profile is deleted from the store");
  assert.deepEqual(a.characterTokens, [], "dropped from the account");
});

test("accountCount reflects created accounts", () => {
  const before = accountCount();
  createAccountRecord({ email: "n1@x.io", passwordHash: "h" });
  createAccountRecord({ email: "n2@x.io", passwordHash: "h" });
  assert.equal(accountCount(), before + 2);
});
