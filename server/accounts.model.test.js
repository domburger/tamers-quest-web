import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData } from "../src/engine/gamedata.js";
import {
  createAccountRecord, getAccountBySession, findAccountByEmail, findAccountByOAuth,
  accountAddCharacter, accountCharacters, accountRemoveCharacter, getByToken, accountCount,
  accountAttachExistingCharacter, migrateProfileToAccount, createProfile, createAccount, findByEmail,
  ensureAccountForProfile, getAccountById,
  sendFriendRequest, acceptFriendRequest, declineFriendRequest, removeFriend, blockAccount, unblockAccount,
  listFriends, listRequests, isBlocked, MAX_PENDING_REQUESTS,
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

test("accountAttachExistingCharacter: adds an existing profile as a character (no new profile minted)", () => {
  loadData();
  const a = createAccountRecord({ email: "att@x.io", passwordHash: "h" });
  const p = createProfile("Existing", { isGuest: true }); // a guest's existing save
  const ok = accountAttachExistingCharacter(a, p);
  assert.equal(ok, true);
  assert.deepEqual(a.characterTokens, [p.token], "the existing profile token is attached");
  assert.equal(p.ownerAccountId, a.id, "tagged with the owner");
  assert.equal(p.isGuest, false, "guest flag cleared (now an account character)");
  assert.equal(getByToken(p.token), p, "same profile object — not re-minted");
  // Idempotent on the token.
  accountAttachExistingCharacter(a, p);
  assert.equal(a.characterTokens.length, 1, "attaching the same profile twice is a no-op");
});

test("migrateProfileToAccount: a legacy credentialed profile becomes an account whose first character IS that save", () => {
  loadData();
  // The OLD model: createAccount stamps email+hash onto a playable game profile.
  const legacy = createAccount("legacy@x.io", "scrypt$s$h", "OldTimer");
  assert.ok(legacy.passwordHash && legacy.activeMonsters.length, "legacy profile has creds + a team");
  const acct = migrateProfileToAccount(legacy);
  assert.equal(acct.email, "legacy@x.io", "credentials copied onto the account");
  assert.equal(acct.passwordHash, "scrypt$s$h");
  assert.deepEqual(acct.characterTokens, [legacy.token], "the existing save is the account's first character (not lost)");
  assert.equal(accountCharacters(acct)[0], legacy, "and it's the same profile object — progress preserved");
  assert.equal(findByEmail("legacy@x.io"), legacy, "old-style lookup still resolves during the transition");
});

test("ensureAccountForProfile: migrates a legacy profile once, then is idempotent (same account)", () => {
  loadData();
  const legacy = createAccount("ensure@x.io", "scrypt$s$h", "Ensurer");
  const a1 = ensureAccountForProfile(legacy);
  assert.ok(a1 && a1.characterTokens.includes(legacy.token), "first call wraps the profile as a character");
  assert.equal(legacy.ownerAccountId, a1.id, "the profile now points back at its account");
  const a2 = ensureAccountForProfile(legacy);
  assert.equal(a2, a1, "second call returns the SAME account (no duplicate migration)");
  assert.equal(getAccountById(a1.id), a1, "resolvable by id");
  assert.equal(ensureAccountForProfile(null), null, "nullish profile → null (never throws)");
});

test("ensureAccountForProfile: a lost ownerAccountId (flush race) re-attaches by credential, no DUPLICATE", () => {
  loadData();
  const legacy = createAccount("dedup@x.io", "scrypt$s$h", "Dedup");
  const a1 = ensureAccountForProfile(legacy);
  const before = accountCount();
  // Simulate the profile's migration flush being LOST on a restart: it reloads WITHOUT ownerAccountId.
  delete legacy.ownerAccountId;
  const a2 = ensureAccountForProfile(legacy);
  assert.equal(a2, a1, "re-attached to the SAME account (found by email), not a fresh one");
  assert.equal(accountCount(), before, "no duplicate account minted for one identity");
  assert.equal(legacy.ownerAccountId, a1.id, "ownerAccountId re-stamped");
});

// ── Social graph (TQ-72) ──
const acct = (n) => createAccountRecord({ email: `${n}@x.io`, passwordHash: "h", nickname: n });

test("friend request → accept makes a MUTUAL friendship; request clears both sides", () => {
  const a = acct("fa1"), b = acct("fb1");
  assert.equal(sendFriendRequest(a, b.id), "sent");
  assert.deepEqual(a.outgoingRequests, [b.id], "tracked as outgoing on the sender");
  assert.deepEqual(b.incomingRequests, [a.id], "and incoming on the recipient");
  assert.equal(acceptFriendRequest(b, a.id), true);
  assert.ok(a.friends.includes(b.id) && b.friends.includes(a.id), "friends on BOTH records");
  assert.deepEqual(b.incomingRequests, [], "incoming cleared");
  assert.deepEqual(a.outgoingRequests, [], "outgoing cleared");
  assert.deepEqual(listFriends(a), [b.id]);
});

test("a RECIPROCAL request auto-accepts into a friendship", () => {
  const a = acct("fa2"), b = acct("fb2");
  assert.equal(sendFriendRequest(a, b.id), "sent");
  assert.equal(sendFriendRequest(b, a.id), "friends", "b requesting back auto-accepts");
  assert.ok(a.friends.includes(b.id) && b.friends.includes(a.id));
});

test("decline drops the request both ways; no friendship formed", () => {
  const a = acct("fa3"), b = acct("fb3");
  sendFriendRequest(a, b.id);
  assert.equal(declineFriendRequest(b, a.id), true);
  assert.deepEqual(b.incomingRequests, []);
  assert.deepEqual(a.outgoingRequests, [], "sender's outgoing cleared too");
  assert.equal(b.friends.length + a.friends.length, 0, "not friends");
});

test("removeFriend is mutual", () => {
  const a = acct("fa4"), b = acct("fb4");
  sendFriendRequest(a, b.id); acceptFriendRequest(b, a.id);
  assert.equal(removeFriend(a, b.id), true);
  assert.ok(!a.friends.includes(b.id) && !b.friends.includes(a.id), "removed on both sides");
  assert.equal(removeFriend(a, b.id), false, "removing a non-friend → false");
});

test("self-request, duplicate, and unknown-target are rejected", () => {
  const a = acct("fa5"), b = acct("fb5");
  assert.equal(sendFriendRequest(a, a.id), "self");
  assert.equal(sendFriendRequest(a, "ac_does_not_exist"), "unknown");
  assert.equal(sendFriendRequest(a, b.id), "sent");
  assert.equal(sendFriendRequest(a, b.id), "pending", "duplicate request rejected");
  acceptFriendRequest(b, a.id);
  assert.equal(sendFriendRequest(a, b.id), "exists", "already friends");
});

test("block drops friendship + pending requests both ways and prevents new requests", () => {
  const a = acct("fa6"), b = acct("fb6");
  sendFriendRequest(a, b.id); acceptFriendRequest(b, a.id);
  assert.equal(blockAccount(a, b.id), true);
  assert.ok(!a.friends.includes(b.id) && !b.friends.includes(a.id), "friendship severed both ways");
  assert.ok(isBlocked(a, b.id));
  assert.equal(sendFriendRequest(b, a.id), "blocked", "the blocked party can't request");
  assert.equal(sendFriendRequest(a, b.id), "blocked", "and I can't request someone I blocked");
  assert.equal(unblockAccount(a, b.id), true);
  assert.equal(sendFriendRequest(a, b.id), "sent", "requests work again after unblock (friendship NOT auto-restored)");
});

test("pending-request cap is enforced", () => {
  const a = acct("facap");
  for (let i = 0; i < MAX_PENDING_REQUESTS; i++) a.outgoingRequests.push(`ac_filler_${i}`);
  const b = acct("fbcap");
  assert.equal(sendFriendRequest(a, b.id), "full", "no new request past the cap");
});

test("listRequests / listFriends return copies (defensive), default for DB-loaded accounts without fields", () => {
  const a = acct("flist"), b = acct("fdb");
  sendFriendRequest(a, b.id);
  const reqs = listRequests(a);
  reqs.outgoing.push("tamper");
  assert.deepEqual(a.outgoingRequests, [b.id], "mutating the returned list doesn't affect the account");
  // An account loaded before this feature (no social arrays) is defaulted, not crashed.
  const legacyShape = createAccountRecord({ email: "old@x.io", passwordHash: "h" });
  delete legacyShape.friends; delete legacyShape.incomingRequests; delete legacyShape.outgoingRequests; delete legacyShape.blocked;
  assert.deepEqual(listFriends(legacyShape), [], "missing arrays default to []");
  assert.equal(sendFriendRequest(legacyShape, a.id), "sent", "helpers work on a legacy-shaped account");
});

test("accountCount reflects created accounts", () => {
  const before = accountCount();
  createAccountRecord({ email: "n1@x.io", passwordHash: "h" });
  createAccountRecord({ email: "n2@x.io", passwordHash: "h" });
  assert.equal(accountCount(), before + 2);
});
