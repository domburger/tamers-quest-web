import { randomBytes } from "node:crypto";
import { findByOAuth, linkOAuth, findByEmail, claimAccount, claimOAuth, ensureAccountForProfile, findAccountByOAuth, findAccountByEmail, findAccountByVerifiedEmail, accountLinkProvider, createAccountRecord, accountCharacters, getAccountBySession, accountAttachProvider, issuePasswordReset, consumePasswordReset, accountSetPassword, issueEmailVerification, consumeEmailVerification, accountMarkEmailVerified } from "./store.js";
import { sendEmail } from "./email.js";
import { hashPassword, verifyPassword, normalizeEmail, validateEmail, validatePassword } from "./accounts.js";
import { createIpRateLimiter, clientIp } from "./ratelimit.js";

const authWriteLimiter = createIpRateLimiter({ capacity: 20, refillPerSec: 0.2 });

export const PROVIDERS = {
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    profileUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
    idField: "sub",
    emailVerifiedField: "email_verified",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
  },
  discord: {
    authorizeUrl: "https://discord.com/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    profileUrl: "https://discord.com/api/users/@me",
    scope: "identify",
    idField: "id",
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

export function providerConfigured(provider) {
  if (!isProvider(provider)) return false;
  const { id, secret } = creds(provider);
  return !!(id && secret);
}

export function configuredProviders() {
  return Object.keys(PROVIDERS).filter(providerConfigured);
}

const STATE_TTL_MS = 10 * 60 * 1000;
const stateStore = new Map();
const claimStore = new Map();
const attachStore = new Map();

const DUMMY_PASSWORD_HASH = hashPassword("tq-login-timing-equalizer");

const STATE_MAX_KEYS = 50000;
function sweepExpired(now) {
  if (stateStore.size < STATE_MAX_KEYS && claimStore.size < STATE_MAX_KEYS && attachStore.size < STATE_MAX_KEYS) return;
  for (const [k, v] of stateStore) if (v.exp <= now) stateStore.delete(k);
  for (const [k, v] of claimStore) if (v.exp <= now) claimStore.delete(k);
  for (const [k, v] of attachStore) if (v.exp <= now) attachStore.delete(k);
  if (stateStore.size >= STATE_MAX_KEYS) stateStore.clear();
  if (claimStore.size >= STATE_MAX_KEYS) claimStore.clear();
  if (attachStore.size >= STATE_MAX_KEYS) attachStore.clear();
}
export function makeState(provider, now = Date.now(), claimToken = null, attachSession = null) {
  sweepExpired(now);
  const state = randomBytes(24).toString("hex");
  stateStore.set(state, { provider, exp: now + STATE_TTL_MS });
  if (claimToken) claimStore.set(state, { claimToken, exp: now + STATE_TTL_MS });
  if (attachSession) attachStore.set(state, { attachSession, exp: now + STATE_TTL_MS });
  return state;
}

export function consumeClaim(state, now = Date.now()) {
  for (const [k, v] of claimStore) if (v.exp <= now) claimStore.delete(k);
  const entry = state && claimStore.get(state);
  if (!entry) return null;
  claimStore.delete(state);
  return entry.exp > now ? entry.claimToken : null;
}

export function consumeAttach(state, now = Date.now()) {
  for (const [k, v] of attachStore) if (v.exp <= now) attachStore.delete(k);
  const entry = state && attachStore.get(state);
  if (!entry) return null;
  attachStore.delete(state);
  return entry.exp > now ? entry.attachSession : null;
}

export function consumeState(state, provider, now = Date.now()) {
  for (const [k, v] of stateStore) if (v.exp <= now) stateStore.delete(k);
  const entry = state && stateStore.get(state);
  if (!entry) return null;
  stateStore.delete(state);
  if (entry.exp <= now || entry.provider !== provider) return null;
  return entry.provider;
}

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
  if (provider === "google") { q.set("access_type", "online"); q.set("prompt", "select_account"); }
  return `${cfg.authorizeUrl}?${q.toString()}`;
}

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

export async function fetchOAuthProfile(provider, accessToken, fetchImpl = fetch) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`unknown provider: ${provider}`);
  const res = await fetchImpl(cfg.profileUrl, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${provider} profile ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const p = await res.json();
  const providerId = p && p[cfg.idField] != null ? String(p[cfg.idField]) : null;
  if (!providerId) throw new Error(`${provider}: profile missing ${cfg.idField}`);
  const name = p.name || p.global_name || p.username || null;
  // Security: drop provider emails that aren't verified (account-merge spoof).
  const vf = cfg.emailVerifiedField;
  const verified = vf ? (p[vf] === true || p[vf] === "true") : false;
  const email = verified && typeof p.email === "string" && p.email ? p.email : null;
  return { provider, providerId, email, name };
}

function redirect(res, location) { res.writeHead(302, { Location: location }); res.end(); }
function sendJson(res, status, obj) { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); }

function readJsonBody(req, max = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "", over = false;
    req.on("data", (c) => { if (over) return; data += c; if (data.length > max) { over = true; reject(new Error("too large")); } });
    req.on("end", () => { if (over) return; try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("bad json")); } });
    req.on("error", reject);
  });
}

const LOGIN_MAX = 8, LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_KEYS = 50000;
const loginAttempts = new Map();
function loginThrottled(email, now = Date.now()) {
  const a = loginAttempts.get(email);
  if (a && a.resetAt > now && a.n >= LOGIN_MAX) return true;
  return false;
}
function noteLoginFail(email, now = Date.now()) {
  const a = loginAttempts.get(email);
  if (!a || a.resetAt <= now) {
    if (loginAttempts.size >= LOGIN_MAX_KEYS) {
      for (const [k, v] of loginAttempts) if (v.resetAt <= now) loginAttempts.delete(k);
      if (loginAttempts.size >= LOGIN_MAX_KEYS) loginAttempts.clear();
    }
    loginAttempts.set(email, { n: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else a.n += 1;
}
function clearLoginFails(email) { loginAttempts.delete(email); }

// Fixed origin: Railway's proxy Host is unreliable (redirect_uri_mismatch).
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || "https://tamersquest.com").replace(/\/+$/, "");
function originOf(_req) {
  return PUBLIC_ORIGIN;
}

const STATE_COOKIE = "tq_oauth_state";
const COOKIE_SECURE = PUBLIC_ORIGIN.startsWith("https:");
function stateCookie(value, maxAgeSec) {
  const a = [`${STATE_COOKIE}=${value}`, "Path=/auth", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSec}`];
  if (COOKIE_SECURE) a.push("Secure");
  return a.join("; ");
}
function readStateCookie(req) {
  const raw = (req && req.headers && req.headers.cookie) || "";
  for (const part of String(raw).split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === STATE_COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}

async function sendVerificationEmail(account, req) {
  if (!account || !account.email || account.emailVerified) return;
  const token = issueEmailVerification(account);
  if (!token) return;
  const link = `${originOf(req)}/auth/verify-email?token=${encodeURIComponent(token)}`;
  const html = `<p>Welcome to Tamer's Quest! Confirm this email to finish setting up your account.</p>`
    + `<p><a href="${link}">Verify my email</a> — this link expires in 24 hours.</p>`
    + `<p>If you didn't create an account, you can ignore this email.</p>`;
  await sendEmail({ to: account.email, subject: "Verify your Tamer's Quest email", html, text: `Verify your email: ${link} (expires in 24 hours).` }).catch(() => {});
}

export async function handleAuthHttp(req, res, fetchImpl = fetch) {
  const url = req.url || "";
  if (!url.startsWith("/auth/")) return false;
  const u = new URL(url, "http://internal");
  const parts = u.pathname.split("/").filter(Boolean);

  if (u.pathname === "/auth/providers") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ providers: configuredProviders() }));
    return true;
  }

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
      if (findByEmail(email) || findAccountByEmail(email)) { sendJson(res, 409, { error: "email_taken" }); return true; }
      const hash = hashPassword(pw);
      const providedNick = body.nickname ? String(body.nickname).trim().slice(0, 24) : "";
      const nick = providedNick || email.split("@")[0].slice(0, 24);
      const claimed = body.token ? claimAccount(body.token, email, hash) : null;
      if (claimed) {
        const account = ensureAccountForProfile(claimed);
        await sendVerificationEmail(account, req);
        sendJson(res, 200, { token: claimed.token, claimed: true, accountSession: account?.sessionToken || null });
      } else {
        const account = createAccountRecord({ email, passwordHash: hash, nickname: nick, usernameChosen: !!providedNick });
        await sendVerificationEmail(account, req);
        sendJson(res, 200, { token: null, claimed: false, accountSession: account.sessionToken });
      }
      return true;
    }

    if (loginThrottled(email)) { sendJson(res, 429, { error: "too_many_attempts" }); return true; }
    const accountByEmail = findAccountByEmail(email);
    const legacy = accountByEmail ? null : findByEmail(email);
    // Always run scrypt (dummy hash if unknown) so timing can't enumerate accounts.
    const credHash = accountByEmail ? accountByEmail.passwordHash : (legacy ? legacy.passwordHash : DUMMY_PASSWORD_HASH);
    const pwOk = verifyPassword(body && body.password, credHash);
    if ((!accountByEmail && !legacy) || !pwOk) {
      noteLoginFail(email);
      sendJson(res, 401, { error: "invalid_credentials" });
      return true;
    }
    clearLoginFails(email);
    const account = accountByEmail || ensureAccountForProfile(legacy);
    const first = accountCharacters(account)[0];
    sendJson(res, 200, { token: first?.token || null, accountSession: account?.sessionToken || null });
    return true;
  }

  if (u.pathname === "/auth/forgot-password" || u.pathname === "/auth/reset-password") {
    if ((req.method || "GET") !== "POST") { sendJson(res, 405, { error: "method_not_allowed" }); return true; }
    if (!authWriteLimiter.allow(clientIp(req))) { sendJson(res, 429, { error: "rate_limited" }); return true; }
    let body;
    try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: "bad_request" }); return true; }

    if (u.pathname === "/auth/forgot-password") {
      // Always reply ok: never reveal whether the email has an account.
      const email = normalizeEmail(body && body.email);
      const account = email ? findAccountByEmail(email) : null;
      if (account) {
        const token = issuePasswordReset(account);
        const link = `${originOf(req)}/?reset=${encodeURIComponent(token)}`;
        const html = `<p>We received a request to reset your Tamer's Quest password.</p>`
          + `<p><a href="${link}">Set a new password</a> — this link expires in 30 minutes and works once.</p>`
          + `<p>Didn't request it? You can ignore this email; your password won't change.</p>`;
        await sendEmail({ to: email, subject: "Reset your Tamer's Quest password", html, text: `Set a new password: ${link} (expires in 30 minutes).` }).catch(() => {});
      }
      sendJson(res, 200, { ok: true });
      return true;
    }

    const pw = body && body.password;
    const pwOk = validatePassword(pw);
    if (!pwOk.ok) { sendJson(res, 400, { error: "weak_password", message: pwOk.reason }); return true; }
    const account = consumePasswordReset(body && body.token);
    if (!account) { sendJson(res, 400, { error: "invalid_or_expired" }); return true; }
    accountSetPassword(account, hashPassword(pw));
    if (account.email) clearLoginFails(account.email);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (u.pathname === "/auth/verify-email" && (req.method || "GET") === "GET") {
    const account = consumeEmailVerification(u.searchParams.get("token"));
    if (account) accountMarkEmailVerified(account);
    redirect(res, account ? "/?verified=1" : "/?verified=0");
    return true;
  }
  if (u.pathname === "/auth/resend-verification") {
    if ((req.method || "GET") !== "POST") { sendJson(res, 405, { error: "method_not_allowed" }); return true; }
    if (!authWriteLimiter.allow(clientIp(req))) { sendJson(res, 429, { error: "rate_limited" }); return true; }
    let body; try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: "bad_request" }); return true; }
    const email = normalizeEmail(body && body.email);
    const account = email ? findAccountByEmail(email) : null;
    if (account && !account.emailVerified) await sendVerificationEmail(account, req);
    sendJson(res, 200, { ok: true });
    return true;
  }

  const provider = parts[1];
  const isCallback = parts[2] === "callback";
  if (!isProvider(provider)) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("unknown auth provider"); return true; }
  if (!providerConfigured(provider)) { redirect(res, "/?login=unavailable"); return true; }
  if (!authWriteLimiter.allow(clientIp(req))) { redirect(res, "/?login=failed"); return true; }

  const redirectUri = `${originOf(req)}/auth/${provider}/callback`;

  if (!isCallback) {
    const state = makeState(provider, Date.now(), u.searchParams.get("claim") || null, u.searchParams.get("attach") || null);
    res.setHeader("Set-Cookie", stateCookie(state, Math.floor(STATE_TTL_MS / 1000)));
    redirect(res, buildAuthUrl(provider, { redirectUri, state }));
    return true;
  }

  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  const cookieState = readStateCookie(req);
  const claimToken = consumeClaim(state);
  const attachSession = consumeAttach(state);
  res.setHeader("Set-Cookie", stateCookie("", 0));
  // Check the cookie before consumeState so a forged state can't burn the real one.
  if (u.searchParams.get("error") || !code || !state || !cookieState || cookieState !== state || !consumeState(state, provider)) { redirect(res, "/?login=failed"); return true; }
  try {
    const token = await exchangeCode(provider, { code, redirectUri }, fetchImpl);
    const prof = await fetchOAuthProfile(provider, token, fetchImpl);
    if (attachSession) {
      const account = getAccountBySession(attachSession);
      if (!account) { redirect(res, "/?login=failed"); return true; }
      const r = accountAttachProvider(account, provider, prof.providerId, prof.email);
      const q = r.ok ? `linked=${provider}` : `linkerror=${r.reason || "failed"}`;
      redirect(res, `/?acct=${encodeURIComponent(account.sessionToken)}&${q}`);
      return true;
    }
    let profile = findByOAuth(provider, prof.providerId);
    if (profile && prof.email && !profile.email) linkOAuth(profile, provider, prof.providerId, prof.email);
    if (!profile && claimToken) profile = claimOAuth(claimToken, provider, prof.providerId, prof.email);

    let account;
    let createdNew = false;
    if (profile) {
      account = ensureAccountForProfile(profile);
    } else {
      account = findAccountByOAuth(provider, prof.providerId);
      // Auto-link only OAuth-verified emails; never to a native account (takeover).
      if (!account && prof.email) {
        const linked = findAccountByVerifiedEmail(prof.email);
        if (linked) account = accountLinkProvider(linked, provider, prof.providerId, prof.email);
      }
      if (!account) {
        account = createAccountRecord({ [`${provider}Id`]: prof.providerId, email: prof.email, nickname: (prof.email && prof.email.split("@")[0]) || "Tamer" });
        createdNew = true;
      }
    }
    const first = accountCharacters(account)[0];
    const tokenParam = first?.token ? `token=${encodeURIComponent(first.token)}&` : "";
    const newParam = (createdNew && !account.usernameChosen) ? "&new=1" : "";
    redirect(res, `/?${tokenParam}acct=${encodeURIComponent(account.sessionToken)}${newParam}`);
  } catch (e) {
    console.error(`[auth] ${provider} callback failed:`, e.message);
    redirect(res, "/?login=failed");
  }
  return true;
}
