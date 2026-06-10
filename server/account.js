// Cloud-save character CRUD (Phase 2). Owns /account/* — gated by the account SESSION token that
// auth.js issues on login/signup/OAuth. An account owns N character profiles; these endpoints let a
// logged-in client list / create / delete them so characters follow the account across devices.
// Guests have no account session, so they can't reach these (they play session-only — Phase 3).
//
// The session token is presented ONLY in the `x-account-session` request header — never a URL
// query: a token in the query string leaks into access logs, the Referer header, and browser
// history (session-fixation/leak risk). It's an unguessable CSPRNG token (the auth gate); a per-IP
// limiter on writes is defense-in-depth.

import {
  getAccountBySession, accountCharacters, accountAddCharacter, accountRemoveCharacter, accountSetNickname,
} from "./store.js";
import { createIpRateLimiter, clientIp } from "./ratelimit.js";

const MAX_CHARACTERS = 5; // mirror the client's character-select slot cap
const writeLimiter = createIpRateLimiter({ capacity: 20, refillPerSec: 0.2 }); // same budget as auth writes

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

function readJsonBody(req, max = 4 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "", over = false;
    req.on("data", (c) => { if (over) return; data += c; if (data.length > max) { over = true; reject(new Error("too large")); } });
    req.on("end", () => { if (over) return; try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("bad json")); } });
    req.on("error", reject);
  });
}

// A safe, compact view of a character profile for the client's character-select list (the same
// fields the local-storage character cards render: name, level, lifetime stats, a team preview).
export function serializeCharacter(p) {
  return {
    token: p.token,
    id: p.id,
    name: p.name || "Tamer",
    level: p.level || 1,
    gold: p.gold || 0,
    isGuest: false,
    stats: p.stats || {},
    // Per-character recent-run log (profile page "match history"); newest first, capped server-side.
    matchHistory: Array.isArray(p.matchHistory) ? p.matchHistory.slice(0, 20) : [],
    activeMonsters: (p.activeMonsters || []).map((m) => ({
      typeName: m.typeName, name: m.name, level: m.level,
      currentHealth: m.currentHealth, maxHealth: m.maxHealth,
    })),
  };
}

// Account identity + aggregate view for the login indicator and the profile page. Safe to
// expose to the authenticated client: the username, which sign-in methods are linked (booleans
// only — never the email/secret), whether a username was explicitly chosen, and the owned
// characters (each with stats + match history via serializeCharacter).
export function serializeAccount(account) {
  const chars = accountCharacters(account).map(serializeCharacter);
  return {
    id: account.id,
    nickname: account.nickname || "Tamer",
    usernameChosen: !!account.usernameChosen,
    providers: {
      google: !!account.googleId,
      discord: !!account.discordId,
      password: !!account.passwordHash,
    },
    hasEmail: !!account.email,
    characters: chars,
  };
}

// Header-only — see the module note. Never read the session from the URL query.
function sessionOf(req) {
  const h = req.headers["x-account-session"];
  return (typeof h === "string" && h) ? h : null;
}

// Returns true if it handled the request (so index.js stops). Unknown /account/* → 404 JSON.
export async function handleAccountHttp(req, res) {
  const url = req.url || "";
  if (!url.startsWith("/account/")) return false;
  const u = new URL(url, "http://internal");

  // Account identity + profile data (login indicator + profile page). Read-only GET.
  if (u.pathname === "/account/me") {
    const account = getAccountBySession(sessionOf(req));
    if (!account) { sendJson(res, 401, { error: "unauthorized" }); return true; }
    if ((req.method || "GET") !== "GET") { sendJson(res, 405, { error: "method_not_allowed" }); return true; }
    sendJson(res, 200, { account: serializeAccount(account) });
    return true;
  }

  // Set the account's display username (first-login prompt + profile-page rename). POST { name }.
  if (u.pathname === "/account/username") {
    const account = getAccountBySession(sessionOf(req));
    if (!account) { sendJson(res, 401, { error: "unauthorized" }); return true; }
    if ((req.method || "GET") !== "POST") { sendJson(res, 405, { error: "method_not_allowed" }); return true; }
    if (!writeLimiter.allow(clientIp(req))) { sendJson(res, 429, { error: "rate_limited" }); return true; }
    let body;
    try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: "bad_request" }); return true; }
    const name = String((body && body.name) || "").trim().slice(0, 24);
    if (!name) { sendJson(res, 400, { error: "invalid_name" }); return true; }
    const nickname = accountSetNickname(account, name);
    sendJson(res, 200, { ok: true, nickname });
    return true;
  }

  if (u.pathname === "/account/characters") {
    const account = getAccountBySession(sessionOf(req));
    if (!account) { sendJson(res, 401, { error: "unauthorized" }); return true; }
    const method = req.method || "GET";

    if (method === "GET") {
      sendJson(res, 200, { characters: accountCharacters(account).map(serializeCharacter) });
      return true;
    }
    if (method === "POST" || method === "DELETE") {
      if (!writeLimiter.allow(clientIp(req))) { sendJson(res, 429, { error: "rate_limited" }); return true; }
      let body;
      try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: "bad_request" }); return true; }

      if (method === "POST") { // create a character
        const name = String((body && body.name) || "").trim().slice(0, 24) || account.nickname || "Tamer";
        const p = accountAddCharacter(account, name, { maxSlots: MAX_CHARACTERS });
        if (!p) { sendJson(res, 409, { error: "slots_full" }); return true; }
        sendJson(res, 200, { character: serializeCharacter(p) });
        return true;
      }
      // DELETE — remove one owned character
      const ok = accountRemoveCharacter(account, body && body.token);
      if (!ok) { sendJson(res, 404, { error: "not_found" }); return true; }
      sendJson(res, 200, { ok: true, characters: accountCharacters(account).map(serializeCharacter) });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  sendJson(res, 404, { error: "not_found" });
  return true;
}
