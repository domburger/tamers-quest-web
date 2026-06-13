import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData } from "../src/engine/gamedata.js";
import { handleAccountHttp } from "./account.js";
import { createAccountRecord, getByToken, getAccountBySession } from "./store.js";
import { hashPassword, verifyPassword } from "./accounts.js";
import { accountAttachProvider, accountMethodCount } from "./store.js";

// The /account/* CRUD endpoints back cloud saves: a logged-in client lists/creates/deletes the
// characters its account owns. accountAddCharacter rolls starters, so real monster data is needed.
function loadData() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"), attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"), items: read("item.json"), spiritChains: read("spiritchains.json"),
  });
}

function mockRes() {
  const out = { status: 0, headers: {}, body: "" };
  return { out, writeHead(s, h) { out.status = s; Object.assign(out.headers, h || {}); }, end(b) { out.body = b || ""; } };
}
const body = (r) => JSON.parse(r.out.body);
// Distinct client IP per request so the per-IP write rate-limiter buckets DON'T bleed across tests
// (a shared "unknown" IP let one test's POSTs drain the 20-token bucket and 429 a later test).
let _ipSeq = 0;
const mockIp = () => `10.0.${Math.floor(_ipSeq / 250)}.${(++_ipSeq) % 250}`;
const mockGet = (url, session) => ({ url, method: "GET", headers: session ? { "x-account-session": session } : {}, socket: { remoteAddress: mockIp() } });
function mockBodyReq(url, method, session, bodyObj) {
  const handlers = {};
  const req = { url, method, headers: session ? { "x-account-session": session } : {}, socket: { remoteAddress: mockIp() }, on(ev, cb) { handlers[ev] = cb; return req; } };
  queueMicrotask(() => { handlers.data && handlers.data(JSON.stringify(bodyObj || {})); handlers.end && handlers.end(); });
  return req;
}

test("handleAccountHttp ignores non-/account URLs (returns false → other routes run)", async () => {
  assert.equal(await handleAccountHttp(mockGet("/index.html"), mockRes()), false);
});

test("account CRUD: rejected without a valid account session (401)", async () => {
  loadData();
  const r = mockRes();
  assert.equal(await handleAccountHttp(mockGet("/account/characters", "tk_not_a_session"), r), true);
  assert.equal(r.out.status, 401);
  const r2 = mockRes();
  await handleAccountHttp(mockGet("/account/characters"), r2); // no session header
  assert.equal(r2.out.status, 401);
});

test("account CRUD: a session in the URL query is NOT accepted (header-only — no token-in-URL leak)", async () => {
  loadData();
  const s = createAccountRecord({ email: "url@x.io", passwordHash: "h" }).sessionToken;
  const r = mockRes();
  // A VALID session, but presented via ?session= (query) with no header → must be rejected, so a
  // session token can never authenticate from a URL (logs / Referer / history leak surface).
  await handleAccountHttp({ url: "/account/characters?session=" + s, method: "GET", headers: {}, socket: {} }, r);
  assert.equal(r.out.status, 401, "query-string session ignored; only the x-account-session header authenticates");
});

test("account CRUD: list starts empty, create adds a playable character, delete removes (owned only)", async () => {
  loadData();
  const s = createAccountRecord({ email: "crud@x.io", passwordHash: "h" }).sessionToken;

  let r = mockRes();
  await handleAccountHttp(mockGet("/account/characters", s), r);
  assert.deepEqual(body(r).characters, [], "fresh account has no characters");

  r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/characters", "POST", s, { name: "Hero" }), r);
  assert.equal(r.out.status, 200);
  const ch = body(r).character;
  assert.equal(ch.name, "Hero");
  assert.ok(ch.token && ch.activeMonsters.length > 0, "returns a serialized character with a team");
  assert.ok(getByToken(ch.token), "the character is a real server profile (playable via the lobby join)");

  r = mockRes();
  await handleAccountHttp(mockGet("/account/characters", s), r);
  assert.equal(body(r).characters.length, 1, "now listed");

  r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/characters", "DELETE", s, { token: "tk_someoneelse" }), r);
  assert.equal(r.out.status, 404, "can't delete a token the account doesn't own");

  r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/characters", "DELETE", s, { token: ch.token }), r);
  assert.equal(r.out.status, 200);
  assert.deepEqual(body(r).characters, [], "owned character removed");
  assert.equal(getByToken(ch.token), null, "its server profile is deleted");
});

test("GET /account/me: returns identity (username, linked providers as booleans, no secrets) + characters", async () => {
  loadData();
  const acct = createAccountRecord({ email: "me@x.io", passwordHash: "h", googleId: "g-123", nickname: "me" });
  const s = acct.sessionToken;

  // create one character so the aggregate view has data
  await handleAccountHttp(mockBodyReq("/account/characters", "POST", s, { name: "Scout" }), mockRes());

  const r = mockRes();
  assert.equal(await handleAccountHttp(mockGet("/account/me", s), r), true);
  assert.equal(r.out.status, 200);
  const a = body(r).account;
  assert.equal(a.nickname, "me");
  assert.equal(a.usernameChosen, false, "email-handle default is NOT a chosen username");
  assert.deepEqual(a.providers, { google: true, discord: false, password: true });
  assert.equal(a.hasEmail, true);
  assert.equal(a.email, undefined, "the raw email is never exposed — only hasEmail");
  assert.equal(a.passwordHash, undefined, "no secret leaks");
  assert.equal(a.characters.length, 1);
  assert.equal(a.characters[0].name, "Scout");
  assert.ok(Array.isArray(a.characters[0].matchHistory), "match history field present (empty until a run logs)");

  const bad = mockRes();
  await handleAccountHttp(mockGet("/account/me", "tk_nope"), bad);
  assert.equal(bad.out.status, 401, "rejected without a valid session");
});

test("POST /account/username: sets the display name + marks it chosen; rejects blank", async () => {
  loadData();
  const s = createAccountRecord({ email: "rename@x.io", passwordHash: "h", nickname: "rename" }).sessionToken;

  let r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/username", "POST", s, { name: "  Stormcaller  " }), r);
  assert.equal(r.out.status, 200);
  assert.equal(body(r).nickname, "Stormcaller", "trimmed + applied");

  r = mockRes();
  await handleAccountHttp(mockGet("/account/me", s), r);
  assert.equal(body(r).account.nickname, "Stormcaller");
  assert.equal(body(r).account.usernameChosen, true, "now an explicitly chosen username (no re-prompt)");

  r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/username", "POST", s, { name: "   " }), r);
  assert.equal(r.out.status, 400);
  assert.equal(body(r).error, "invalid_name", "a blank username is rejected");

  r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/username", "POST", "tk_nope", { name: "X" }), r);
  assert.equal(r.out.status, 401, "rejected without a valid session");
});

test("POST /account/delete: purges the account + all owned characters; session invalidated (TQ-11)", async () => {
  loadData();
  const acct = createAccountRecord({ email: "del@x.io", passwordHash: "h", nickname: "Goner" });
  const s = acct.sessionToken;

  // give it two characters
  let r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/characters", "POST", s, { name: "A" }), r);
  const tokA = body(r).character.token;
  r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/characters", "POST", s, { name: "B" }), r);
  const tokB = body(r).character.token;
  assert.ok(getByToken(tokA) && getByToken(tokB), "both characters exist before delete");

  // wrong method is rejected
  r = mockRes();
  await handleAccountHttp(mockGet("/account/delete", s), r);
  assert.equal(r.out.status, 405, "GET not allowed");

  // delete
  r = mockRes();
  assert.equal(await handleAccountHttp(mockBodyReq("/account/delete", "POST", s, {}), r), true);
  assert.equal(r.out.status, 200);
  assert.equal(body(r).ok, true);

  // no orphans: both profiles gone, account/session invalidated
  assert.equal(getByToken(tokA), null, "character A purged");
  assert.equal(getByToken(tokB), null, "character B purged");
  assert.equal(getAccountBySession(s), null, "the session no longer resolves to an account");

  // a follow-up call with the dead session is now unauthorized
  r = mockRes();
  await handleAccountHttp(mockGet("/account/me", s), r);
  assert.equal(r.out.status, 401, "deleted account's session is dead");
});

test("POST /account/delete: rejected without a valid session (401)", async () => {
  loadData();
  const r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/delete", "POST", "tk_nope", {}), r);
  assert.equal(r.out.status, 401);
});

test("POST /account/password: re-auth with current, sets a new scrypt hash; old fails, new works (TQ-58)", async () => {
  loadData();
  const acct = createAccountRecord({ email: "pw@x.io", passwordHash: hashPassword("oldpass123"), nickname: "Pw" });
  const s = acct.sessionToken;

  // wrong current password → 401, hash unchanged
  let r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/password", "POST", s, { currentPassword: "WRONG", newPassword: "newpass456" }), r);
  assert.equal(r.out.status, 401);
  assert.ok(verifyPassword("oldpass123", acct.passwordHash), "hash unchanged after a failed attempt");

  // weak new password → 400
  r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/password", "POST", s, { currentPassword: "oldpass123", newPassword: "short" }), r);
  assert.equal(r.out.status, 400);
  assert.equal(body(r).error, "weak_password");

  // valid change → 200; old password no longer verifies, new one does; session still resolves
  r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/password", "POST", s, { currentPassword: "oldpass123", newPassword: "newpass456" }), r);
  assert.equal(r.out.status, 200);
  assert.equal(body(r).ok, true);
  assert.equal(verifyPassword("oldpass123", acct.passwordHash), false, "old password rejected after change");
  assert.ok(verifyPassword("newpass456", acct.passwordHash), "new password works");
  assert.ok(getAccountBySession(s), "session token unchanged — user stays logged in");

  // non-POST → 405; no session → 401
  r = mockRes();
  await handleAccountHttp(mockGet("/account/password", s), r);
  assert.equal(r.out.status, 405);
  r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/password", "POST", "tk_nope", { currentPassword: "x", newPassword: "newpass456" }), r);
  assert.equal(r.out.status, 401);
});

test("POST /account/password: OAuth-only account (no password) → 400 no_password", async () => {
  loadData();
  const s = createAccountRecord({ email: "g@x.io", googleId: "g-1", nickname: "G" }).sessionToken;
  const r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/password", "POST", s, { currentPassword: "x", newPassword: "newpass456" }), r);
  assert.equal(r.out.status, 400);
  assert.equal(body(r).error, "no_password");
});

test("POST /account/unlink: removes a method but never the last one (TQ-61)", async () => {
  loadData();
  // account with TWO methods: password + google
  const acct = createAccountRecord({ email: "link@x.io", passwordHash: hashPassword("pw12345678"), googleId: "g-77" });
  const s = acct.sessionToken;
  assert.equal(accountMethodCount(acct), 2);

  // unlink google → ok, providers reflect it
  let r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/unlink", "POST", s, { method: "google" }), r);
  assert.equal(r.out.status, 200);
  assert.deepEqual(body(r).providers, { google: false, discord: false, password: true });

  // unlinking a method that isn't linked → 400 not_linked
  r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/unlink", "POST", s, { method: "discord" }), r);
  assert.equal(r.out.status, 400);
  assert.equal(body(r).error, "not_linked");

  // password is now the ONLY method → refuse (409 last_method, no lockout)
  r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/unlink", "POST", s, { method: "password" }), r);
  assert.equal(r.out.status, 409);
  assert.equal(body(r).error, "last_method");
  assert.ok(acct.passwordHash, "the last method was NOT removed");

  // invalid method → 400; no session → 401
  r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/unlink", "POST", s, { method: "facebook" }), r);
  assert.equal(r.out.status, 400);
  r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/unlink", "POST", "tk_nope", { method: "google" }), r);
  assert.equal(r.out.status, 401);
});

test("accountAttachProvider: rejects a provider id already bound to another account (TQ-61)", () => {
  loadData();
  const a = createAccountRecord({ email: "a@x.io", passwordHash: hashPassword("pw12345678") });
  const b = createAccountRecord({ email: "b@x.io", googleId: "g-existing" });
  // attaching g-existing (already B's) to A must be refused
  assert.deepEqual(accountAttachProvider(a, "google", "g-existing"), { ok: false, reason: "conflict" });
  assert.ok(!a.googleId, "A did not get the conflicting id");
  // a fresh id attaches fine
  assert.deepEqual(accountAttachProvider(a, "google", "g-fresh"), { ok: true });
  assert.equal(a.googleId, "g-fresh");
});

test("account CRUD: create caps at 5 slots (409 slots_full)", async () => {
  loadData();
  const s = createAccountRecord({ email: "cap@x.io", passwordHash: "h" }).sessionToken;
  for (let i = 0; i < 5; i++) {
    const r = mockRes();
    await handleAccountHttp(mockBodyReq("/account/characters", "POST", s, { name: `C${i}` }), r);
    assert.equal(r.out.status, 200, `slot ${i} created`);
  }
  const r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/characters", "POST", s, { name: "Overflow" }), r);
  assert.equal(r.out.status, 409);
  assert.equal(body(r).error, "slots_full");
});

// ── Friends endpoints (TQ-73) ──
test("friends: request → accept → GET lists the mutual friend (safe view: id+nickname, no email)", async () => {
  const a = createAccountRecord({ email: "fra@x.io", passwordHash: "h", nickname: "Aaa" });
  const b = createAccountRecord({ email: "frb@x.io", passwordHash: "h", nickname: "Bbb" });
  let r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/friends/request", "POST", a.sessionToken, { id: b.id }), r);
  assert.equal(r.out.status, 200);
  assert.equal(body(r).status, "sent");
  // B sees A as an incoming request — safe view only.
  r = mockRes();
  await handleAccountHttp(mockGet("/account/friends", b.sessionToken), r);
  assert.deepEqual(body(r).incoming.map((x) => x.id), [a.id]);
  assert.equal(body(r).incoming[0].nickname, "Aaa");
  assert.ok(!("email" in body(r).incoming[0]), "no email leaked in the friend view");
  // B accepts → both list the other as a friend.
  r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/friends/accept", "POST", b.sessionToken, { id: a.id }), r);
  assert.equal(r.out.status, 200);
  r = mockRes();
  await handleAccountHttp(mockGet("/account/friends", a.sessionToken), r);
  assert.deepEqual(body(r).friends.map((x) => x.id), [b.id]);
});

test("friends: 401 without a session; self-request 400; unknown target 404", async () => {
  const a = createAccountRecord({ email: "frc@x.io", passwordHash: "h" });
  let r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/friends/request", "POST", null, { id: "ac_x" }), r);
  assert.equal(r.out.status, 401);
  r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/friends/request", "POST", a.sessionToken, { id: a.id }), r);
  assert.equal(r.out.status, 400);
  assert.equal(body(r).error, "self");
  r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/friends/request", "POST", a.sessionToken, { id: "ac_missing" }), r);
  assert.equal(r.out.status, 404);
});

test("friends: remove drops the friend; block → 409 on a later request; unblock restores it", async () => {
  const a = createAccountRecord({ email: "frd@x.io", passwordHash: "h" });
  const b = createAccountRecord({ email: "fre@x.io", passwordHash: "h" });
  await handleAccountHttp(mockBodyReq("/account/friends/request", "POST", a.sessionToken, { id: b.id }), mockRes());
  await handleAccountHttp(mockBodyReq("/account/friends/accept", "POST", b.sessionToken, { id: a.id }), mockRes());
  let r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/friends", "DELETE", a.sessionToken, { id: b.id }), r);
  assert.equal(r.out.status, 200);
  assert.deepEqual(body(r).friends, []);
  await handleAccountHttp(mockBodyReq("/account/friends/block", "POST", a.sessionToken, { id: b.id }), mockRes());
  r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/friends/request", "POST", a.sessionToken, { id: b.id }), r);
  assert.equal(r.out.status, 409);
  assert.equal(body(r).error, "blocked");
  await handleAccountHttp(mockBodyReq("/account/friends/unblock", "POST", a.sessionToken, { id: b.id }), mockRes());
  r = mockRes();
  await handleAccountHttp(mockBodyReq("/account/friends/request", "POST", a.sessionToken, { id: b.id }), r);
  assert.equal(r.out.status, 200);
});

test("friends: GET reflects live presence (online / in-run / offline) from active sessions (TQ-74)", async () => {
  const a = createAccountRecord({ email: "pa@x.io", passwordHash: "h", nickname: "Pa" });
  const b = createAccountRecord({ email: "pb@x.io", passwordHash: "h", nickname: "Pb" });
  const c = createAccountRecord({ email: "pc@x.io", passwordHash: "h", nickname: "Pc" });
  const d = createAccountRecord({ email: "pd@x.io", passwordHash: "h", nickname: "Pd" });
  // a befriends b, c, d.
  for (const f of [b, c, d]) {
    await handleAccountHttp(mockBodyReq("/account/friends/request", "POST", a.sessionToken, { id: f.id }), mockRes(), null);
    await handleAccountHttp(mockBodyReq("/account/friends/accept", "POST", f.sessionToken, { id: a.id }), mockRes(), null);
  }
  // Fake world: b has an idle session (online), c is in an active round (in-run), d has a
  // DISCONNECTED grace-window session (offline). a is the viewer with no session of its own.
  const world = { sessions: new Map([
    ["pl_b", { profile: { ownerAccountId: b.id }, state: "idle" }],
    ["pl_c", { profile: { ownerAccountId: c.id }, state: "in_round" }],
    ["pl_d", { profile: { ownerAccountId: d.id }, state: "idle", disconnected: true }],
  ]) };
  const r = mockRes();
  await handleAccountHttp(mockGet("/account/friends", a.sessionToken), r, world);
  const status = Object.fromEntries(body(r).friends.map((f) => [f.id, f.status]));
  assert.equal(status[b.id], "online", "connected idle character → online");
  assert.equal(status[c.id], "in-run", "session in an active round → in-run");
  assert.equal(status[d.id], "offline", "disconnected grace-window session → offline");
  // Without a world (WS-less / older callers) every friend reads offline.
  const r2 = mockRes();
  await handleAccountHttp(mockGet("/account/friends", a.sessionToken), r2);
  assert.ok(body(r2).friends.every((f) => f.status === "offline"), "no world → all offline");
});
