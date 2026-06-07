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
  makeState, consumeState, buildAuthUrl, exchangeCode, fetchOAuthProfile, handleAuthHttp,
} from "./auth.js";
import { findByOAuth, profileCount } from "./store.js";

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
  const g = await fetchOAuthProfile("google", "AT", okFetch({ sub: "12345", email: "a@b.com", name: "Ada" }));
  assert.deepEqual(g, { provider: "google", providerId: "12345", email: "a@b.com", name: "Ada" });

  // Discord with identify-only (no email) + global_name display name.
  const d = await fetchOAuthProfile("discord", "AT", okFetch({ id: "98765", username: "rex", global_name: "Rex" }));
  assert.deepEqual(d, { provider: "discord", providerId: "98765", email: null, name: "Rex" });

  // Numeric ids are stringified; username falls back when global_name is absent.
  const d2 = await fetchOAuthProfile("discord", "AT", okFetch({ id: 42, username: "neo" }));
  assert.equal(d2.providerId, "42");
  assert.equal(d2.name, "neo");
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
    assert.equal(loc.searchParams.get("redirect_uri"), "http://x/auth/google/callback");
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

test("full OAuth callback: creates a profile on first login, reuses it on the second", async () => {
  loadData();
  await withEnv({ GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gs" }, async () => {
    // 1) Start the flow to mint a real CSRF state, then read it back from the redirect.
    const start = mockRes();
    await handleAuthHttp(mockReq("/auth/google"), start);
    const state = new URL(start.out.headers.Location).searchParams.get("state");

    // Mocked provider: token exchange then userinfo (sub = stable account id).
    const fetchImpl = async (url) => String(url).includes("/token")
      ? { ok: true, status: 200, text: async () => "", json: async () => ({ access_token: "AT" }) }
      : { ok: true, status: 200, text: async () => "", json: async () => ({ sub: "google-7777", email: "ada@x.com", name: "Ada" }) };

    const before = profileCount();
    const cb = mockRes();
    await handleAuthHttp(mockReq(`/auth/google/callback?code=c0de&state=${state}`), cb, fetchImpl);
    assert.equal(cb.out.status, 302);
    assert.ok(cb.out.headers.Location.startsWith("/?token="), "hands back a session token");
    assert.equal(profileCount(), before + 1, "a new profile was created");
    const linked = findByOAuth("google", "google-7777");
    assert.ok(linked && linked.googleId === "google-7777" && linked.email === "ada@x.com", "profile linked by googleId + email");
    assert.equal(linked.isGuest, false, "OAuth login is a real (non-guest) account");

    // 2) Second login with the same sub reuses the profile (state must be fresh — single-use).
    const start2 = mockRes();
    await handleAuthHttp(mockReq("/auth/google"), start2);
    const state2 = new URL(start2.out.headers.Location).searchParams.get("state");
    const before2 = profileCount();
    const cb2 = mockRes();
    await handleAuthHttp(mockReq(`/auth/google/callback?code=c0de2&state=${state2}`), cb2, fetchImpl);
    assert.equal(profileCount(), before2, "no new profile — existing account reused");
    assert.equal(new URL("http://x" + cb2.out.headers.Location).searchParams.get("token"), linked.token, "same session token");
  });
});
