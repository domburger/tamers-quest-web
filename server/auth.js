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
import { createProfile, findByOAuth, linkOAuth, findByEmail, createAccount, claimAccount, claimOAuth } from "./store.js";
import { hashPassword, verifyPassword, normalizeEmail, validateEmail, validatePassword } from "./accounts.js";
import { createIpRateLimiter, clientIp } from "./ratelimit.js";

// Per-IP flood guard on the native-account write endpoints (LS-20): bulk signup (profile
// spam) + credential stuffing across many emails from one IP (the per-EMAIL login
// throttle alone doesn't stop a one-try-per-email sweep). Generous — 20 burst, 12/min
// sustained — so real sign-up/sign-in never trips. Same x-forwarded-for caveat applies.
const authWriteLimiter = createIpRateLimiter({ capacity: 20, refillPerSec: 0.2 });

// Per-provider endpoints + scopes. `idField` is where the provider puts the stable
// account id in its userinfo response (Google: OIDC `sub`; Discord: `id`).
export const PROVIDERS = {
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    profileUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
    idField: "sub",
    // SECURITY (audit #1): only TRUST the provider email when it's verified. Google's
    // OIDC userinfo carries `email_verified`; an unverified Google email must NOT become
    // a trusted account attribute (it's a latent account-merge/spoof primitive).
    emailVerifiedField: "email_verified",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
  },
  discord: {
    authorizeUrl: "https://discord.com/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    profileUrl: "https://discord.com/api/users/@me",
    scope: "identify", // the user couldn't find a "profile" scope; identify is correct
    idField: "id",
    // Discord's user object reports email verification under `verified`.
    emailVerifiedField: "verified",
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
// AUTH-T4: a parallel, state-keyed store for the anon session token an OAuth login wants
// to CLAIM (carried across the provider round-trip). Separate map so consumeState's API
// is unchanged; consumed independently in the callback.
const claimStore = new Map(); // state -> { claimToken, exp }

// A constant, well-formed scrypt record used to EQUALIZE login timing: when the email
// is unknown we still verify the password against this dummy so a real scrypt cost is
// paid on every login, regardless of whether the account exists. Without it, an unknown
// email skips scrypt and replies measurably faster than a known-email/wrong-password,
// leaking which emails are registered via response TIMING (user enumeration) — the
// uniform "invalid_credentials" message alone doesn't close that channel.
const DUMMY_PASSWORD_HASH = hashPassword("tq-login-timing-equalizer");

const STATE_MAX_KEYS = 50000; // SECURITY (audit #4): cap both state maps; the per-IP throttle
// on /auth/:provider is the first line, this is the backstop against map-flooding.
function sweepExpired(now) {
  if (stateStore.size < STATE_MAX_KEYS && claimStore.size < STATE_MAX_KEYS) return;
  for (const [k, v] of stateStore) if (v.exp <= now) stateStore.delete(k);
  for (const [k, v] of claimStore) if (v.exp <= now) claimStore.delete(k);
  if (stateStore.size >= STATE_MAX_KEYS) stateStore.clear();
  if (claimStore.size >= STATE_MAX_KEYS) claimStore.clear();
}
export function makeState(provider, now = Date.now(), claimToken = null) {
  sweepExpired(now);
  const state = randomBytes(24).toString("hex");
  stateStore.set(state, { provider, exp: now + STATE_TTL_MS });
  if (claimToken) claimStore.set(state, { claimToken, exp: now + STATE_TTL_MS }); // AUTH-T4
  return state;
}

// AUTH-T4: read + consume the anon token to claim for this OAuth flow (single-use, TTL'd).
export function consumeClaim(state, now = Date.now()) {
  for (const [k, v] of claimStore) if (v.exp <= now) claimStore.delete(k);
  const entry = state && claimStore.get(state);
  if (!entry) return null;
  claimStore.delete(state);
  return entry.exp > now ? entry.claimToken : null;
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
  // SECURITY (audit #1): drop the email to null unless the provider says it's VERIFIED.
  // An attacker can put an arbitrary UNVERIFIED email on a Google/Discord account; trusting
  // it would let them seed/merge on a victim's email. `verified` may be a bool or "true".
  const vf = cfg.emailVerifiedField;
  const verified = vf ? (p[vf] === true || p[vf] === "true") : false;
  const email = verified && typeof p.email === "string" && p.email ? p.email : null; // may be absent (esp. Discord identify)
  return { provider, providerId, email, name };
}

// ── HTTP routes (AUTH-T2) ──
// Owns /auth/*. Returns true if it handled the request (so index.js falls through to
// static serving otherwise). Two routes per provider, plus a tiny capabilities probe:
//   GET /auth/providers          → { providers: [...configured] } (client shows buttons)
//   GET /auth/:provider          → 302 to the provider's consent screen (mints CSRF state)
//   GET /auth/:provider/callback → code→token→profile→find-or-create+link→302 /?token=…
// On any failure we redirect to /?login=failed (never leak provider error detail). The
// session token handed back is the profile's existing token; the client (AUTH-T1) reads
// ?token and resumes the session exactly like an anonymous login.
function redirect(res, location) { res.writeHead(302, { Location: location }); res.end(); }
function sendJson(res, status, obj) { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); }

// Read a small JSON POST body (size-capped so a giant payload can't OOM us).
function readJsonBody(req, max = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "", over = false;
    req.on("data", (c) => { if (over) return; data += c; if (data.length > max) { over = true; reject(new Error("too large")); } });
    req.on("end", () => { if (over) return; try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("bad json")); } });
    req.on("error", reject);
  });
}

// AUTH-T3 brute-force guard: a small in-memory per-email login-attempt limiter with a
// time window. Generic enough for the no-DB case; resets on success. (HTTP has no
// per-connection bucket like WS, so login needs its own.)
const LOGIN_MAX = 8, LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_KEYS = 50000; // SECURITY (audit #4): bound the map so an attacker probing
// millions of distinct emails (each failing once) can't exhaust memory.
const loginAttempts = new Map(); // email -> { n, resetAt }
function loginThrottled(email, now = Date.now()) {
  const a = loginAttempts.get(email);
  if (a && a.resetAt > now && a.n >= LOGIN_MAX) return true;
  return false;
}
function noteLoginFail(email, now = Date.now()) {
  const a = loginAttempts.get(email);
  if (!a || a.resetAt <= now) {
    // Bound the map (audit #4): when full, evict expired windows first, then hard-clear as a
    // backstop — same pattern as createIpRateLimiter's map. Never grows without limit.
    if (loginAttempts.size >= LOGIN_MAX_KEYS) {
      for (const [k, v] of loginAttempts) if (v.resetAt <= now) loginAttempts.delete(k);
      if (loginAttempts.size >= LOGIN_MAX_KEYS) loginAttempts.clear();
    }
    loginAttempts.set(email, { n: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else a.n += 1;
}
function clearLoginFails(email) { loginAttempts.delete(email); }

// The public origin used to build the OAuth redirect_uri. It must EXACTLY match the URI
// registered with the provider (Google/Discord) AND be identical between the authorize
// step and the token exchange. Behind Railway's proxy the request `host` is NOT reliably
// the public domain (it can be an internal/railway host) — deriving it from headers caused
// `redirect_uri_mismatch` (Error 400). So we use a FIXED canonical origin: `PUBLIC_ORIGIN`
// env if set, else the production domain. (For local OAuth testing set
// PUBLIC_ORIGIN=http://localhost:8080 and register that callback with the provider.)
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || "https://tamersquest.com").replace(/\/+$/, "");
function originOf(_req) {
  return PUBLIC_ORIGIN;
}

export async function handleAuthHttp(req, res, fetchImpl = fetch) {
  const url = req.url || "";
  if (!url.startsWith("/auth/")) return false;
  const u = new URL(url, "http://internal"); // base only used to parse path + query
  const parts = u.pathname.split("/").filter(Boolean); // ["auth", provider, ("callback")?]

  if (u.pathname === "/auth/providers") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ providers: configuredProviders() }));
    return true;
  }

  // ── Native "Tamer's Account" (AUTH-T3): email + password, JSON POST ──
  if (u.pathname === "/auth/signup" || u.pathname === "/auth/login") {
    if ((req.method || "GET") !== "POST") { sendJson(res, 405, { error: "method_not_allowed" }); return true; }
    if (!authWriteLimiter.allow(clientIp(req))) { sendJson(res, 429, { error: "rate_limited" }); return true; }
    let body;
    try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: "bad_request" }); return true; }
    const email = normalizeEmail(body && body.email);

    if (u.pathname === "/auth/signup") {
      const pw = body && body.password;
      if (!validateEmail(email)) { sendJson(res, 400, { error: "invalid_email" }); return true; }
      const pwOk = validatePassword(pw);
      if (!pwOk.ok) { sendJson(res, 400, { error: "weak_password", message: pwOk.reason }); return true; }
      if (findByEmail(email)) { sendJson(res, 409, { error: "email_taken" }); return true; }
      const hash = hashPassword(pw);
      const nick = (body.nickname || email.split("@")[0]).slice(0, 24);
      // AUTH-T4: if the caller sent their current anon session token, upgrade THAT profile
      // in place (keeps their save) instead of orphaning it behind a fresh account. Falls
      // back to a new account when there's no token or it's already a native account.
      const claimed = body.token ? claimAccount(body.token, email, hash) : null;
      const profile = claimed || createAccount(email, hash, nick);
      sendJson(res, 200, { token: profile.token, claimed: !!claimed });
      return true;
    }

    // login — uniform "invalid_credentials" for unknown-email AND wrong-password so the
    // response can't be used to enumerate which emails have accounts.
    if (loginThrottled(email)) { sendJson(res, 429, { error: "too_many_attempts" }); return true; }
    const acct = findByEmail(email);
    // Verify UNCONDITIONALLY — against DUMMY_PASSWORD_HASH for an unknown email — so the
    // scrypt cost (and thus the response time) is the same whether or not the account
    // exists. Prevents timing-based user enumeration (loginThrottled is per-email, so it
    // doesn't stop one-request-per-candidate probing).
    const pwOk = verifyPassword(body && body.password, acct ? acct.passwordHash : DUMMY_PASSWORD_HASH);
    if (!acct || !pwOk) {
      noteLoginFail(email);
      sendJson(res, 401, { error: "invalid_credentials" });
      return true;
    }
    clearLoginFails(email);
    sendJson(res, 200, { token: acct.token });
    return true;
  }

  const provider = parts[1];
  const isCallback = parts[2] === "callback";
  if (!isProvider(provider)) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("unknown auth provider"); return true; }
  if (!providerConfigured(provider)) { redirect(res, "/?login=unavailable"); return true; }
  // SECURITY (audit #2): throttle the OAuth start+callback per IP. Unthrottled, /auth/:provider
  // floods the in-memory state/claim maps and /callback triggers an outbound token-exchange
  // fetch per request (cost amplification + burns provider quota). The same generous bucket
  // as the native-account writes — a real 2-request login never trips it.
  if (!authWriteLimiter.allow(clientIp(req))) { redirect(res, "/?login=failed"); return true; }

  const redirectUri = `${originOf(req)}/auth/${provider}/callback`;

  if (!isCallback) {
    // Start the flow: mint CSRF state (carrying any anon token to claim, AUTH-T4), send
    // the user to the provider's consent screen.
    const state = makeState(provider, Date.now(), u.searchParams.get("claim") || null);
    redirect(res, buildAuthUrl(provider, { redirectUri, state }));
    return true;
  }

  // Callback: validate state (single-use CSRF), exchange the code, link/find the account.
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  const claimToken = consumeClaim(state); // AUTH-T4: read before consumeState deletes the state side
  if (u.searchParams.get("error") || !code || !consumeState(state, provider)) { redirect(res, "/?login=failed"); return true; }
  try {
    const token = await exchangeCode(provider, { code, redirectUri }, fetchImpl);
    const prof = await fetchOAuthProfile(provider, token, fetchImpl);
    let profile = findByOAuth(provider, prof.providerId);
    if (profile) {
      if (prof.email && !profile.email) linkOAuth(profile, provider, prof.providerId, prof.email); // backfill email on return
    } else {
      // No account for this provider id yet. AUTH-T4: claim the anon profile in place when
      // one was carried through; else create a fresh linked profile.
      profile = (claimToken && claimOAuth(claimToken, provider, prof.providerId, prof.email))
        || linkOAuth(createProfile((prof.name || "Tamer").slice(0, 24)), provider, prof.providerId, prof.email);
    }
    redirect(res, `/?token=${encodeURIComponent(profile.token)}`);
  } catch (e) {
    console.error(`[auth] ${provider} callback failed:`, e.message);
    redirect(res, "/?login=failed");
  }
  return true;
}
