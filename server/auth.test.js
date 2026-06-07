// AUTH-T2: unit coverage for the OAuth helper core (server/auth.js). Network calls
// are exercised with a mock fetch — no real OAuth needed. The route + profile-store
// wiring is a separate slice (see the AUTH-T2 plan note); this proves the hard parts:
// config gating, authorize-URL building, single-use CSRF state, token exchange, and
// provider-profile normalization.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDERS, isProvider, providerConfigured, configuredProviders,
  makeState, consumeState, buildAuthUrl, exchangeCode, fetchOAuthProfile,
} from "./auth.js";

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return fn(); }
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

test("providerConfigured / configuredProviders reflect env credentials", () => {
  withEnv({ GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "gs", DISCORD_CLIENT_ID: undefined, DISCORD_CLIENT_SECRET: undefined }, () => {
    assert.equal(providerConfigured("google"), true);
    assert.equal(providerConfigured("discord"), false, "missing secret → not configured");
    assert.deepEqual(configuredProviders(), ["google"]);
  });
  withEnv({ GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: undefined }, () => {
    assert.equal(providerConfigured("google"), false, "id without secret → not configured");
  });
});

test("buildAuthUrl carries client_id, redirect_uri, scope, state, response_type=code", () => {
  withEnv({ GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gs" }, () => {
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
