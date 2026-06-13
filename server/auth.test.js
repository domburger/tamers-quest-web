// AUTH-T2: unit coverage for the OAuth helper core (server/auth.js). Network calls
// are exercised with a mock fetch — no real OAuth needed. The route + profile-store
// wiring is a separate slice (see the AUTH-T2 plan note); this proves the hard parts:
// config gating, authorize-URL building, single-use CSRF state, token exchange, and
// provider-profile normalization.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData } from "../src/engine/gamedata.js";
import {
  PROVIDERS, isProvider, providerConfigured, configuredProviders,
  makeState, consumeState, consumeClaim, buildAuthUrl, exchangeCode, fetchOAuthProfile, handleAuthHttp,
} from "./auth.js";
import { findByOAuth, findByEmail, profileCount, createProfile, getAccountBySession, accountCharacters, createAccountRecord } from "./store.js";

// createProfile (used by the callback) rolls starters + grants chains, so the game
// data must be loaded for the handler tests.
function loadData() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"), attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"), items: read("item.json"), spiritChains: read("spiritchains.json"),
  });
}

function mockRes() {
  const out = { status: 0, headers: {}, body: "" };
  return { out, setHeader(k, v) { out.headers[k] = v; }, writeHead(s, h) { out.status = s; Object.assign(out.headers, h || {}); }, end(b) { out.body = b || ""; } };
}
const mockReq = (url, headers = { host: "x" }) => ({ url, headers, socket: {} });
// POST-capable mock: fires data/end on the next microtask so the handler's readJsonBody
// attaches its listeners first.
function mockPost(url, bodyObj, ip) {
  const handlers = {};
  const headers = { host: "x", ...(ip ? { "x-forwarded-for": ip } : {}) };
  const req = { url, method: "POST", headers, socket: {}, on(ev, cb) { handlers[ev] = cb; return req; } };
  queueMicrotask(() => { handlers.data && handlers.data(JSON.stringify(bodyObj)); handlers.end && handlers.end(); });
  return req;
}

// Async-aware: AWAIT fn so env stays set for the whole (possibly async) body — a sync
// version would restore env at the first await, un-setting creds mid-flow.
async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); }
  finally { for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}

const okFetch = (payload, { ok = true, status = 200 } = {}) => async () => ({
  ok, status, text: async () => JSON.stringify(payload), json: async () => payload,
});

test("isProvider + PROVIDERS: only google + discord are known", () => {
  assert.ok(isProvider("google") && isProvider("discord"));
  assert.ok(!isProvider("facebook") && !isProvider(""));
  assert.equal(PROVIDERS.discord.scope, "identify"); // user-confirmed scope
});

test("providerConfigured / configuredProviders reflect env credentials", async () => {
  await withEnv({ GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "gs", DISCORD_CLIENT_ID: undefined, DISCORD_CLIENT_SECRET: undefined }, () => {
    assert.equal(providerConfigured("google"), true);
    assert.equal(providerConfigured("discord"), false, "missing secret → not configured");
    assert.deepEqual(configuredProviders(), ["google"]);
  });
  await withEnv({ GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: undefined }, () => {
    assert.equal(providerConfigured("google"), false, "id without secret → not configured");
  });
});

test("buildAuthUrl carries client_id, redirect_uri, scope, state, response_type=code", async () => {
  await withEnv({ GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gs" }, () => {
    const url = new URL(buildAuthUrl("google", { redirectUri: "https://x/auth/google/callback", state: "st8" }));
    assert.ok(url.href.startsWith(PROVIDERS.google.authorizeUrl));
    assert.equal(url.searchParams.get("client_id"), "gid");
    assert.equal(url.searchParams.get("redirect_uri"), "https://x/auth/google/callback");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("scope"), "openid email profile");
    assert.equal(url.searchParams.get("state"), "st8");
  });
  const durl = new URL(buildAuthUrl("discord", { redirectUri: "https://x/auth/discord/callback", state: "s" }));
  assert.ok(durl.href.startsWith(PROVIDERS.discord.authorizeUrl));
  assert.equal(durl.searchParams.get("scope"), "identify");
  assert.throws(() => buildAuthUrl("nope", { redirectUri: "x", state: "y" }), /unknown provider/);
});

test("CSRF state is single-use, provider-bound, and expires", () => {
  const t0 = 1_000_000;
  const s = makeState("google", t0);
  assert.equal(consumeState(s, "discord", t0), null, "provider mismatch rejected");
  // (that attempt consumed it — single use regardless of outcome)
  assert.equal(consumeState(s, "google", t0), null, "already consumed");

  const s2 = makeState("discord", t0);
  assert.equal(consumeState(s2, "discord", t0 + 1000), "discord", "valid within TTL");

  const s3 = makeState("google", t0);
  assert.equal(consumeState(s3, "google", t0 + 11 * 60 * 1000), null, "expired after TTL");

  assert.equal(consumeState("never-minted", "google", t0), null);
  assert.notEqual(makeState("google", t0), makeState("google", t0), "states are unique");
});

test("exchangeCode posts the code and returns the access_token (mocked)", async () => {
  await withEnv({ GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gsec" }, async () => {
    let sentBody = null;
    const fetchImpl = async (url, opts) => { sentBody = opts.body; return { ok: true, status: 200, text: async () => "", json: async () => ({ access_token: "AT123" }) }; };
    const tok = await exchangeCode("google", { code: "c0de", redirectUri: "https://x/cb" }, fetchImpl);
    assert.equal(tok, "AT123");
    const params = new URLSearchParams(sentBody);
    assert.equal(params.get("code"), "c0de");
    assert.equal(params.get("grant_type"), "authorization_code");
    assert.equal(params.get("client_id"), "gid");
    assert.equal(params.get("client_secret"), "gsec");
    assert.equal(params.get("redirect_uri"), "https://x/cb");
  });
});

test("exchangeCode throws on a non-OK token response or a missing token", async () => {
  await assert.rejects(exchangeCode("google", { code: "x", redirectUri: "y" }, okFetch({ error: "bad" }, { ok: false, status: 400 })), /token 400/);
  await assert.rejects(exchangeCode("google", { code: "x", redirectUri: "y" }, okFetch({ not_a_token: 1 })), /no access_token/);
});

test("fetchOAuthProfile normalizes Google (sub) and Discord (id) profiles", async () => {
  // SECURITY (audit #1): the email is only kept when the provider marks it VERIFIED.
  const g = await fetchOAuthProfile("google", "AT", okFetch({ sub: "12345", email: "a@b.com", email_verified: true, name: "Ada" }));
  assert.deepEqual(g, { provider: "google", providerId: "12345", email: "a@b.com", name: "Ada" });

  // Discord with identify-only (no email) + global_name display name.
  const d = await fetchOAuthProfile("discord", "AT", okFetch({ id: "98765", username: "rex", global_name: "Rex", verified: true }));
  assert.deepEqual(d, { provider: "discord", providerId: "98765", email: null, name: "Rex" });

  // Numeric ids are stringified; username falls back when global_name is absent.
  const d2 = await fetchOAuthProfile("discord", "AT", okFetch({ id: 42, username: "neo" }));
  assert.equal(d2.providerId, "42");
  assert.equal(d2.name, "neo");
});

test("fetchOAuthProfile DROPS an unverified provider email (audit #1 — no spoofed-email trust)", async () => {
  // Google account whose email is NOT verified → email must come back null, not trusted.
  const g = await fetchOAuthProfile("google", "AT", okFetch({ sub: "9", email: "attacker@victim.com", email_verified: false, name: "X" }));
  assert.equal(g.email, null, "unverified Google email is dropped");
  // Missing the verified flag entirely is also untrusted.
  const g2 = await fetchOAuthProfile("google", "AT", okFetch({ sub: "10", email: "no-flag@x.com", name: "Y" }));
  assert.equal(g2.email, null, "absent email_verified → dropped");
  // Discord email only trusted when verified === true.
  const d = await fetchOAuthProfile("discord", "AT", okFetch({ id: "11", username: "z", email: "d@x.com", verified: false }));
  assert.equal(d.email, null, "unverified Discord email is dropped");
  const dOk = await fetchOAuthProfile("discord", "AT", okFetch({ id: "12", username: "z2", email: "ok@x.com", verified: true }));
  assert.equal(dOk.email, "ok@x.com", "verified Discord email is kept");
});

test("fetchOAuthProfile throws when the id field is missing or the call fails", async () => {
  await assert.rejects(fetchOAuthProfile("google", "AT", okFetch({ email: "x@y.com" })), /missing sub/);
  await assert.rejects(fetchOAuthProfile("discord", "AT", okFetch({}, { ok: false, status: 401 })), /profile 401/);
});

// ── handleAuthHttp (the /auth/* routes) ──

test("handleAuthHttp ignores non-/auth URLs (returns false → static serving runs)", async () => {
  assert.equal(await handleAuthHttp(mockReq("/index.html"), mockRes()), false);
});

test("GET /auth/providers lists only configured providers", async () => {
  await withEnv({ GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "gs", DISCORD_CLIENT_ID: undefined, DISCORD_CLIENT_SECRET: undefined }, async () => {
    const res = mockRes();
    assert.equal(await handleAuthHttp(mockReq("/auth/providers"), res), true);
    assert.deepEqual(JSON.parse(res.out.body).providers, ["google"]);
  });
});

test("GET /auth/:provider redirects to the consent screen with a state; unknown → 404; unconfigured → /?login=unavailable", async () => {
  await withEnv({ GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gs" }, async () => {
    const res = mockRes();
    await handleAuthHttp(mockReq("/auth/google"), res);
    assert.equal(res.out.status, 302);
    const loc = new URL(res.out.headers.Location);
    assert.ok(loc.href.startsWith(PROVIDERS.google.authorizeUrl));
    // redirect_uri is the FIXED canonical PUBLIC_ORIGIN (not the request host) so it always
    // matches the provider-registered URI behind Railway's proxy — fixes redirect_uri_mismatch.
    assert.equal(loc.searchParams.get("redirect_uri"), "https://tamersquest.com/auth/google/callback");
    assert.ok(loc.searchParams.get("state"), "state minted");
  });
  // Unknown provider → 404.
  const r404 = mockRes();
  await handleAuthHttp(mockReq("/auth/myspace"), r404);
  assert.equal(r404.out.status, 404);
  // Known but unconfigured → graceful redirect.
  await withEnv({ DISCORD_CLIENT_ID: undefined, DISCORD_CLIENT_SECRET: undefined }, async () => {
    const res = mockRes();
    await handleAuthHttp(mockReq("/auth/discord"), res);
    assert.equal(res.out.status, 302);
    assert.equal(res.out.headers.Location, "/?login=unavailable");
  });
});

test("callback with a bad/missing state redirects to /?login=failed (CSRF)", async () => {
  await withEnv({ GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gs" }, async () => {
    const res = mockRes();
    await handleAuthHttp(mockReq("/auth/google/callback?code=abc&state=forged"), res);
    assert.equal(res.out.headers.Location, "/?login=failed");
  });
});

test("TQ-56: start sets a browser-binding cookie; callback REJECTS a valid state replayed without/with a mismatched cookie (login CSRF)", async () => {
  await withEnv({ GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gs" }, async () => {
    // Own IP so these start+callback requests don't drain the SHARED authWriteLimiter bucket and
    // 429 the default-IP signup/claim tests (the rate-limit-isolation pattern used elsewhere here).
    const hdr = { host: "x", "x-forwarded-for": "203.0.113.99" };
    // Start the flow → a REAL server-side state + the browser-binding cookie it sets.
    const start = mockRes();
    await handleAuthHttp(mockReq("/auth/google", hdr), start);
    const state = new URL(start.out.headers.Location).searchParams.get("state");
    const setCookie = start.out.headers["Set-Cookie"];
    assert.ok(/^tq_oauth_state=/.test(setCookie), "start sets the tq_oauth_state cookie");
    assert.ok(/HttpOnly/.test(setCookie) && /SameSite=Lax/.test(setCookie), "cookie is HttpOnly + SameSite=Lax");
    assert.ok(setCookie.includes(state), "cookie value is the minted state");

    // A token-exchange fetch must NEVER fire on a rejected callback (no code spent, no provider quota).
    let fetched = false;
    const fetchImpl = async () => { fetched = true; return { ok: true, status: 200, text: async () => "", json: async () => ({}) }; };

    // Attacker replays the valid state in a victim's browser with NO matching cookie → rejected.
    const noCookie = mockRes();
    await handleAuthHttp(mockReq(`/auth/google/callback?code=stolen&state=${state}`, hdr), noCookie, fetchImpl);
    assert.equal(noCookie.out.headers.Location, "/?login=failed", "no cookie → rejected");

    // A MISMATCHED cookie (a different browser's state) is also rejected. The state was not consumed
    // by the first attempt (cookie check short-circuits before consumeState), so it's reused here.
    const wrongCookie = mockRes();
    await handleAuthHttp(mockReq(`/auth/google/callback?code=stolen&state=${state}`, { ...hdr, cookie: "tq_oauth_state=someoneelses" }), wrongCookie, fetchImpl);
    assert.equal(wrongCookie.out.headers.Location, "/?login=failed", "mismatched cookie → rejected");

    assert.equal(fetched, false, "rejected before any token exchange");
  });
});

test("full OAuth callback: brand-new sign-in creates an EMPTY account (NO auto character), reused on the second login", async () => {
  loadData();
  await withEnv({ GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gs" }, async () => {
    // 1) Start the flow to mint a real CSRF state, then read it back from the redirect.
    const start = mockRes();
    await handleAuthHttp(mockReq("/auth/google"), start);
    const state = new URL(start.out.headers.Location).searchParams.get("state");

    // Mocked provider: token exchange then userinfo (sub = stable account id; name = real name).
    const fetchImpl = async (url) => String(url).includes("/token")
      ? { ok: true, status: 200, text: async () => "", json: async () => ({ access_token: "AT" }) }
      : { ok: true, status: 200, text: async () => "", json: async () => ({ sub: "google-7777", email: "ada@x.com", email_verified: true, name: "Ada Lovelace" }) };

    const before = profileCount();
    const cb = mockRes();
    await handleAuthHttp(mockReq(`/auth/google/callback?code=c0de&state=${state}`, { host: "x", cookie: `tq_oauth_state=${state}` }), cb, fetchImpl);
    assert.equal(cb.out.status, 302);
    const loc = new URL("http://x" + cb.out.headers.Location);
    // NO automated character creation: no profile/character is minted, and no token is handed back.
    assert.equal(profileCount(), before, "no character profile auto-created on sign-in");
    assert.equal(findByOAuth("google", "google-7777"), null, "no legacy profile created (the real name is never seeded as a character)");
    assert.equal(loc.searchParams.get("token"), null, "no character token — the account starts empty");
    const acct = loc.searchParams.get("acct");
    assert.ok(acct, "hands back an account session");
    assert.equal(loc.searchParams.get("new"), "1", "first OAuth login flags new=1 → the client prompts for a username");
    const account = getAccountBySession(acct);
    assert.ok(account && account.googleId === "google-7777", "an empty account linked by googleId");
    assert.equal(accountCharacters(account).length, 0, "ZERO characters — the player creates their own in character-select");
    assert.notEqual(account.nickname, "Ada Lovelace", "the provider's real name is NOT used as a character/display name");

    // 2) Second login with the same sub reuses the SAME empty account (no duplicate, no new chars).
    const start2 = mockRes();
    await handleAuthHttp(mockReq("/auth/google"), start2);
    const state2 = new URL(start2.out.headers.Location).searchParams.get("state");
    const cb2 = mockRes();
    await handleAuthHttp(mockReq(`/auth/google/callback?code=c0de2&state=${state2}`, { host: "x", cookie: `tq_oauth_state=${state2}` }), cb2, fetchImpl);
    const loc2 = new URL("http://x" + cb2.out.headers.Location);
    const acct2 = loc2.searchParams.get("acct");
    assert.equal(acct2, acct, "same account session — the empty account is reused, not duplicated");
    assert.equal(loc2.searchParams.get("new"), null, "a returning account does NOT re-prompt for a username");
    assert.equal(accountCharacters(getAccountBySession(acct2)).length, 0, "still empty after a second sign-in");
  });
});

test("TQ-62 OAuth attach: ?attach= links the provider onto the signed-in account; an id on another account is refused", async () => {
  loadData();
  await withEnv({ GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gs" }, async () => {
    const IP = "203.0.113.62"; // own bucket (rate-limit isolation pattern)
    const profile = async (sub, email) => async (url) => String(url).includes("/token")
      ? { ok: true, status: 200, text: async () => "", json: async () => ({ access_token: "AT" }) }
      : { ok: true, status: 200, text: async () => "", json: async () => ({ sub, email, email_verified: true }) };
    const attachFlow = async (session, fetchImpl) => {
      const start = mockRes();
      await handleAuthHttp(mockReq(`/auth/google?attach=${encodeURIComponent(session)}`, { host: "x", "x-forwarded-for": IP }), start);
      const state = new URL(start.out.headers.Location).searchParams.get("state");
      const cb = mockRes();
      await handleAuthHttp(mockReq(`/auth/google/callback?code=c&state=${state}`, { host: "x", "x-forwarded-for": IP, cookie: `tq_oauth_state=${state}` }), cb, fetchImpl);
      return new URL("http://x" + cb.out.headers.Location);
    };

    // a signed-in native account links Google → attached to THAT account, redirect signals linked=google
    const acct = createAccountRecord({ email: "attach@x.io", passwordHash: "scrypt$0$0" });
    const loc = await attachFlow(acct.sessionToken, await profile("g-attach-1", "attach@x.io"));
    assert.equal(loc.searchParams.get("linked"), "google");
    assert.equal(loc.searchParams.get("acct"), acct.sessionToken, "returns to the same account");
    assert.equal(getAccountBySession(acct.sessionToken).googleId, "g-attach-1", "provider attached");

    // CONFLICT: that google id already belongs to another account → refused (no takeover)
    createAccountRecord({ googleId: "g-taken" });
    const acct2 = createAccountRecord({ email: "a2@x.io", passwordHash: "scrypt$0$0" });
    const loc2 = await attachFlow(acct2.sessionToken, await profile("g-taken", "a2@x.io"));
    assert.equal(loc2.searchParams.get("linkerror"), "conflict");
    assert.ok(!getAccountBySession(acct2.sessionToken).googleId, "acct2 did NOT get the taken id");
  });
});

test("OAuth account LINKING: a 2nd provider with the same VERIFIED email links to the existing account (no duplicate); a native email is NOT auto-linked", async () => {
  loadData();
  await withEnv({ GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gs", DISCORD_CLIENT_ID: "did", DISCORD_CLIENT_SECRET: "ds" }, async () => {
    // Own IP so these ~9 write requests don't drain the SHARED authWriteLimiter bucket and 429 the
    // later native signup/login tests (per the rate-limit-isolation pattern used elsewhere here).
    const IP = "203.0.113.77";
    const hdr = { host: "x", "x-forwarded-for": IP };
    // Drive a full OAuth login for `provider` with a stable id + verified email; return the acct session.
    const login = async (provider, sub, email) => {
      const start = mockRes();
      await handleAuthHttp(mockReq(`/auth/${provider}`, hdr), start);
      const state = new URL(start.out.headers.Location).searchParams.get("state");
      const fetchImpl = async (url) => String(url).includes("/token")
        ? { ok: true, status: 200, text: async () => "", json: async () => ({ access_token: "AT" }) }
        : { ok: true, status: 200, text: async () => "", json: async () =>
            (provider === "google" ? { sub, email, email_verified: true, name: "Dual" }
                                   : { id: sub, email, verified: true, username: "Dual" }) };
      const cb = mockRes();
      await handleAuthHttp(mockReq(`/auth/${provider}/callback?code=c&state=${state}`, { ...hdr, cookie: `tq_oauth_state=${state}` }), cb, fetchImpl);
      return new URL("http://x" + cb.out.headers.Location).searchParams.get("acct");
    };

    // 1) Google sign-in → a fresh account A.
    const acctG = await login("google", "g-1", "dual@x.com");
    const A = getAccountBySession(acctG);
    assert.ok(A && A.googleId === "g-1" && !A.discordId, "Google account created");

    // 2) Discord sign-in with the SAME verified email → LINKS onto A (same session, no duplicate).
    const acctD = await login("discord", "d-1", "dual@x.com");
    assert.equal(acctD, acctG, "same verified email → linked to the SAME account (one person, one account)");
    assert.equal(getAccountBySession(acctG).discordId, "d-1", "Discord provider id linked onto the existing account");

    // 3) Discord sign-in with a DIFFERENT email → a separate account (not over-linked).
    const acctOther = await login("discord", "d-2", "someone-else@x.com");
    assert.notEqual(acctOther, acctG, "a different email is NOT linked — separate account");

    // 4) SECURITY: an OAuth sign-in does NOT auto-link to a NATIVE account by its (unverified) email.
    const sg = mockRes();
    await handleAuthHttp(mockPost("/auth/signup", { email: "native@x.com", password: "hunter2hunter" }, IP), sg);
    const nativeAcct = getAccountBySession(JSON.parse(sg.out.body).accountSession);
    const acctN = await login("google", "g-9", "native@x.com");
    assert.notEqual(getAccountBySession(acctN).id, nativeAcct.id, "OAuth does NOT link to a native account by unverified email (takeover guard)");
  });
});

// ── Native "Tamer's Account" (AUTH-T3): /auth/signup + /auth/login ──

test("POST /auth/signup creates an EMPTY native account (no auto character) + an account session", async () => {
  loadData();
  const before = profileCount();
  const res = mockRes();
  await handleAuthHttp(mockPost("/auth/signup", { email: "New@Player.com", password: "hunter2hunter" }), res);
  assert.equal(res.out.status, 200);
  const body = JSON.parse(res.out.body);
  assert.equal(body.token, null, "no character token — the account starts empty (no auto character)");
  assert.ok(body.accountSession, "an account session is issued");
  assert.equal(profileCount(), before, "no character profile auto-created");
  const acct = getAccountBySession(body.accountSession);
  assert.ok(acct && acct.email === "new@player.com" && acct.passwordHash && acct.isAccount, "an account keyed by normalized email");
  assert.equal(accountCharacters(acct).length, 0, "ZERO characters — the player creates their own in character-select");
});

test("POST /auth/signup with a username applies + marks it chosen; blank defaults to the email handle", async () => {
  loadData();
  // With a username → trimmed, applied, and flagged chosen (so no first-login re-prompt).
  const named = mockRes();
  await handleAuthHttp(mockPost("/auth/signup", { email: "named@x.io", password: "longenough1", nickname: "  Stormcaller  " }, "203.0.113.91"), named);
  assert.equal(named.out.status, 200);
  const a1 = getAccountBySession(JSON.parse(named.out.body).accountSession);
  assert.equal(a1.nickname, "Stormcaller", "the typed username is trimmed + applied");
  assert.equal(a1.usernameChosen, true, "an explicit username is a CHOSEN name");

  // Without a username → the email handle, NOT flagged chosen (a placeholder).
  const anon = mockRes();
  await handleAuthHttp(mockPost("/auth/signup", { email: "Anon.Handle@x.io", password: "longenough1" }, "203.0.113.92"), anon);
  const a2 = getAccountBySession(JSON.parse(anon.out.body).accountSession);
  assert.equal(a2.nickname, "anon.handle", "falls back to the lowercased email handle");
  assert.equal(a2.usernameChosen, false, "an email-handle default is NOT a chosen username");
});

test("Phase 2: signup + login resolve the SAME empty account session (no auto character)", async () => {
  loadData();
  // Distinct source IP so this test's requests use their own rate-limit bucket (the shared
  // authWriteLimiter is module-global across tests — depleting the default bucket would trip a
  // later OAuth test). The helper sets x-forwarded-for from this arg.
  const IP = "203.0.113.77";
  // Signup → an account session for an EMPTY account (no auto character → no token).
  const su = mockRes();
  await handleAuthHttp(mockPost("/auth/signup", { email: "cloud@x.io", password: "longenough1" }, IP), su);
  const sBody = JSON.parse(su.out.body);
  assert.ok(sBody.accountSession, "signup returns an accountSession");
  assert.equal(sBody.token, null, "no auto character → no token");
  const acct = getAccountBySession(sBody.accountSession);
  assert.ok(acct, "the session resolves to an account");
  assert.equal(accountCharacters(acct).length, 0, "the account starts with zero characters");
  // Login → the SAME account session (no duplicate), still no token until the player makes a character.
  const li = mockRes();
  await handleAuthHttp(mockPost("/auth/login", { email: "cloud@x.io", password: "longenough1" }, IP), li);
  const lBody = JSON.parse(li.out.body);
  assert.equal(lBody.accountSession, sBody.accountSession, "login resolves the SAME account (no duplicate)");
  assert.equal(lBody.token, null, "still no character → no token");
});

test("signup rejects duplicate email, invalid email, and weak password", async () => {
  loadData();
  await handleAuthHttp(mockPost("/auth/signup", { email: "dup@x.com", password: "longenough1" }), mockRes());
  const dup = mockRes();
  await handleAuthHttp(mockPost("/auth/signup", { email: "DUP@x.com", password: "anotherlong1" }), dup);
  assert.equal(dup.out.status, 409);
  assert.equal(JSON.parse(dup.out.body).error, "email_taken");

  const bad = mockRes();
  await handleAuthHttp(mockPost("/auth/signup", { email: "not-an-email", password: "longenough1" }), bad);
  assert.equal(bad.out.status, 400);

  const weak = mockRes();
  await handleAuthHttp(mockPost("/auth/signup", { email: "ok@x.com", password: "short" }), weak);
  assert.equal(weak.out.status, 400);
  assert.equal(JSON.parse(weak.out.body).error, "weak_password");
});

test("POST /auth/login verifies the password and is enumeration-safe", async () => {
  loadData();
  const su = mockRes();
  await handleAuthHttp(mockPost("/auth/signup", { email: "log@x.com", password: "correctpass1" }), su);
  const acctSession = JSON.parse(su.out.body).accountSession;

  const ok = mockRes();
  await handleAuthHttp(mockPost("/auth/login", { email: "Log@x.com", password: "correctpass1" }), ok);
  assert.equal(ok.out.status, 200);
  assert.equal(JSON.parse(ok.out.body).accountSession, acctSession, "resolves the SAME account session (case-insensitive email)");

  // Wrong password and unknown email give the SAME 401/error (no user enumeration).
  const wrong = mockRes();
  await handleAuthHttp(mockPost("/auth/login", { email: "log@x.com", password: "nope" }), wrong);
  const unknown = mockRes();
  await handleAuthHttp(mockPost("/auth/login", { email: "ghost@x.com", password: "whatever1" }), unknown);
  assert.equal(wrong.out.status, 401);
  assert.equal(unknown.out.status, 401);
  assert.deepEqual(JSON.parse(wrong.out.body), JSON.parse(unknown.out.body));
});

test("login is brute-force throttled per email", async () => {
  loadData();
  const ip = "10.0.0.1"; // isolate from the shared default-IP bucket (under the per-IP cap)
  await handleAuthHttp(mockPost("/auth/signup", { email: "bf@x.com", password: "realpass12345" }, ip), mockRes());
  let last = mockRes();
  for (let i = 0; i < 9; i++) { last = mockRes(); await handleAuthHttp(mockPost("/auth/login", { email: "bf@x.com", password: "bad" }, ip), last); }
  assert.equal(last.out.status, 429, "locked out after repeated failures");
  assert.equal(JSON.parse(last.out.body).error, "too_many_attempts");
});

test("login is per-IP throttled against credential stuffing (LS-20)", async () => {
  loadData();
  const ip = "10.0.0.2"; // distinct IP; vary the email so the per-EMAIL throttle doesn't trip first
  let last = mockRes();
  for (let i = 0; i < 21; i++) {
    last = mockRes();
    await handleAuthHttp(mockPost("/auth/login", { email: `stuff${i}@x.com`, password: "whatever1" }, ip), last);
    if (last.out.status === 429) break;
  }
  assert.equal(last.out.status, 429, "one IP sweeping many emails gets rate-limited");
  assert.equal(JSON.parse(last.out.body).error, "rate_limited", "tripped the per-IP limiter, not the per-email one");
});

test("signup/login reject non-POST methods", async () => {
  const res = mockRes();
  await handleAuthHttp(mockReq("/auth/signup"), res); // GET
  assert.equal(res.out.status, 405);
});

// ── AUTH-T4: claim / migration (don't orphan an anonymous player's save) ──

test("signup with the anon token CLAIMS the existing profile in place (keeps the save)", async () => {
  loadData();
  const anon = createProfile("Wanderer", { isGuest: true });
  const savedId = anon.id, teamLen = anon.activeMonsters.length;
  const before = profileCount();

  const res = mockRes();
  await handleAuthHttp(mockPost("/auth/signup", { email: "claim@x.com", password: "longenough1", token: anon.token }), res);
  assert.equal(res.out.status, 200);
  const out = JSON.parse(res.out.body);
  assert.equal(out.token, anon.token, "same session token — no new session");
  assert.equal(out.claimed, true);
  assert.equal(profileCount(), before, "no new profile created");
  const acct = findByEmail("claim@x.com");
  assert.equal(acct.id, savedId, "the SAME profile became the account");
  assert.equal(acct.activeMonsters.length, teamLen, "the existing team/save is preserved");
  assert.equal(acct.isGuest, false);
});

test("signup with a token that's already a credentialed account does NOT clobber it (creates a fresh empty account)", async () => {
  loadData();
  // A guest claims their profile via signup → that profile becomes a credentialed (native) account profile.
  const guest = createProfile("Owner", { isGuest: true });
  await handleAuthHttp(mockPost("/auth/signup", { email: "owner@x.com", password: "ownerpass123", token: guest.token }), mockRes());
  const before = profileCount();
  // Signing up again with that SAME token must NOT claim the already-credentialed profile.
  const res = mockRes();
  await handleAuthHttp(mockPost("/auth/signup", { email: "other@x.com", password: "otherpass123", token: guest.token }), res);
  assert.equal(JSON.parse(res.out.body).claimed, false, "did not claim an already-credentialed profile");
  assert.equal(profileCount(), before, "fresh account is empty — no new character profile minted");
  assert.ok(JSON.parse(res.out.body).accountSession, "a fresh empty account was created instead");
  assert.equal(findByEmail("owner@x.com").email, "owner@x.com", "owner's account untouched");
});

test("OAuth login with ?claim CLAIMS the anon profile in place", async () => {
  loadData();
  await withEnv({ GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gs" }, async () => {
    const anon = createProfile("Drifter", { isGuest: true });
    const before = profileCount();
    // Start the flow carrying the anon token to claim; read back the minted state.
    const start = mockRes();
    await handleAuthHttp(mockReq(`/auth/google?claim=${anon.token}`), start);
    const state = new URL(start.out.headers.Location).searchParams.get("state");
    const fetchImpl = async (url) => String(url).includes("/token")
      ? { ok: true, status: 200, text: async () => "", json: async () => ({ access_token: "AT" }) }
      : { ok: true, status: 200, text: async () => "", json: async () => ({ sub: "g-claim-1", email: "d@x.com", name: "Drifter" }) };
    const cb = mockRes();
    await handleAuthHttp(mockReq(`/auth/google/callback?code=c&state=${state}`, { host: "x", cookie: `tq_oauth_state=${state}` }), cb, fetchImpl);
    assert.equal(profileCount(), before, "no new profile — the anon save was claimed");
    const linked = findByOAuth("google", "g-claim-1");
    assert.equal(linked.id, anon.id, "the SAME profile got the google link");
    assert.equal(new URL("http://x" + cb.out.headers.Location).searchParams.get("token"), anon.token, "same session token");
  });
});

test("consumeClaim: one-time retrieval of an OAuth-bound claim token; expiry / unknown / unbound → null", () => {
  const t0 = Date.now();
  // makeState binds a claim token to the returned state (AUTH-T4 guest→account link).
  const s1 = makeState("google", t0, "claim-abc");
  assert.equal(consumeClaim(s1, t0), "claim-abc", "returns the bound claim token");
  assert.equal(consumeClaim(s1, t0), null, "one-time use — already consumed (no replay)");

  // A state with no claim bound → null.
  const s2 = makeState("discord", t0);
  assert.equal(consumeClaim(s2, t0), null, "no claim was bound to this state");

  // Unknown / nullish state → null (never throws).
  assert.equal(consumeClaim("deadbeef", t0), null);
  assert.equal(consumeClaim(undefined, t0), null);

  // Expired claim → null (and swept), so a stale link token can't be redeemed late.
  const s3 = makeState("google", t0, "stale-claim");
  assert.equal(consumeClaim(s3, t0 + 1e12), null, "expired claim is not returned");
});
