// OAuth 2.0 login helpers for Google + Discord (AUTH-T2). This module is the pure,
// testable CORE of the login flow — provider config, the authorize-URL builder, a
// CSRF `state` store, the code→token exchange, and provider-profile normalization.
// It deliberately does NOT touch the HTTP router or the profile store; the callback
// route + profile linking wire these together (see the AUTH-T2 plan note). Keeping
// the network/crypto logic here behind small functions makes it unit-testable with a
// mocked fetch, without standing up real OAuth.
//
// Secrets come from env (set on Railway): GOOGLE_CLIENT_ID/SECRET,
// DISCORD_CLIENT_ID/SECRET. Discord uses the `identify` scope (email may be absent →
// never required for Discord). No new dependencies — raw fetch + node:crypto.

import { randomBytes } from "node:crypto";

// Per-provider endpoints + scopes. `idField` is where the provider puts the stable
// account id in its userinfo response (Google: OIDC `sub`; Discord: `id`).
export const PROVIDERS = {
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    profileUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
    idField: "sub",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
  },
  discord: {
    authorizeUrl: "https://discord.com/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    profileUrl: "https://discord.com/api/users/@me",
    scope: "identify", // the user couldn't find a "profile" scope; identify is correct
    idField: "id",
    clientIdEnv: "DISCORD_CLIENT_ID",
    clientSecretEnv: "DISCORD_CLIENT_SECRET",
  },
};

export function isProvider(p) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, p);
}

function creds(provider) {
  const cfg = PROVIDERS[provider];
  return { id: process.env[cfg.clientIdEnv], secret: process.env[cfg.clientSecretEnv] };
}

// A provider is usable only when BOTH its client id and secret are set in env.
export function providerConfigured(provider) {
  if (!isProvider(provider)) return false;
  const { id, secret } = creds(provider);
  return !!(id && secret);
}

// Which providers are currently usable — for the client to know which buttons to show.
export function configuredProviders() {
  return Object.keys(PROVIDERS).filter(providerConfigured);
}

// ── CSRF state ──
// A short-lived, single-use random token tying the authorize redirect to its callback
// (defends against login CSRF). Stored server-side with a TTL; consumed on callback.
// In-memory is fine: the flow completes in seconds and a restart just means re-login.
const STATE_TTL_MS = 10 * 60 * 1000; // 10 min
const stateStore = new Map(); // state -> { provider, exp }

export function makeState(provider, now = Date.now()) {
  const state = randomBytes(24).toString("hex");
  stateStore.set(state, { provider, exp: now + STATE_TTL_MS });
  return state;
}

// Validate + CONSUME a state token (single-use). Returns the provider it was minted
// for, or null if unknown/expired/mismatched. Also opportunistically sweeps expired
// entries so the map can't grow unbounded under a state-spamming client.
export function consumeState(state, provider, now = Date.now()) {
  for (const [k, v] of stateStore) if (v.exp <= now) stateStore.delete(k);
  const entry = state && stateStore.get(state);
  if (!entry) return null;
  stateStore.delete(state); // single-use regardless of outcome
  if (entry.exp <= now || entry.provider !== provider) return null;
  return entry.provider;
}

// Build the provider's authorize URL to redirect the user to. `redirectUri` must match
// one registered with the provider (e.g. https://tamersquest.com/auth/google/callback).
export function buildAuthUrl(provider, { redirectUri, state }) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`unknown provider: ${provider}`);
  const { id } = creds(provider);
  const q = new URLSearchParams({
    client_id: id || "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: cfg.scope,
    state,
  });
  // Google needs these to reliably return a userinfo-capable token for the OIDC scope.
  if (provider === "google") { q.set("access_type", "online"); q.set("prompt", "select_account"); }
  return `${cfg.authorizeUrl}?${q.toString()}`;
}

// Exchange the authorization `code` for an access token. Throws on any failure (the
// caller turns that into a clean "login failed" redirect).
export async function exchangeCode(provider, { code, redirectUri }, fetchImpl = fetch) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`unknown provider: ${provider}`);
  const { id, secret } = creds(provider);
  const body = new URLSearchParams({
    client_id: id || "",
    client_secret: secret || "",
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetchImpl(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`${provider} token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (!data || !data.access_token) throw new Error(`${provider}: no access_token in token response`);
  return data.access_token;
}

// Fetch + normalize the provider profile into a stable shape:
//   { provider, providerId, email|null, name|null }
// providerId is the account-stable id we link to the local profile (googleId/discordId).
export async function fetchOAuthProfile(provider, accessToken, fetchImpl = fetch) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`unknown provider: ${provider}`);
  const res = await fetchImpl(cfg.profileUrl, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${provider} profile ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const p = await res.json();
  const providerId = p && p[cfg.idField] != null ? String(p[cfg.idField]) : null;
  if (!providerId) throw new Error(`${provider}: profile missing ${cfg.idField}`);
  // Discord's display name is `global_name` (newer) or `username`; Google uses `name`.
  const name = p.name || p.global_name || p.username || null;
  const email = typeof p.email === "string" && p.email ? p.email : null; // may be absent (esp. Discord identify)
  return { provider, providerId, email, name };
}
