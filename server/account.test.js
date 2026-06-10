import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData } from "../src/engine/gamedata.js";
import { handleAccountHttp } from "./account.js";
import { createAccountRecord, getByToken } from "./store.js";

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
const mockGet = (url, session) => ({ url, method: "GET", headers: session ? { "x-account-session": session } : {}, socket: {} });
function mockBodyReq(url, method, session, bodyObj) {
  const handlers = {};
  const req = { url, method, headers: session ? { "x-account-session": session } : {}, socket: {}, on(ev, cb) { handlers[ev] = cb; return req; } };
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
