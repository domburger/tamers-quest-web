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
  getAccountBySession, accountCharacters, accountAddCharacter, accountRemoveCharacter, accountSetNickname, deleteAccount, accountSetPassword, accountUnlinkProvider,
  getAccountById, sendFriendRequest, acceptFriendRequest, declineFriendRequest, removeFriend, blockAccount, unblockAccount, listFriends, listRequests,
} from "./store.js";
import { hashPassword, verifyPassword, validatePassword } from "./accounts.js"; // TQ-58: change-password (scrypt)
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
    level: p.level || 1, // TQ-186: account prestige level
    xp: p.xp || 0, // TQ-186: carry-over XP toward the next account level
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

// Friends presence (TQ-74): the live status of the given account ids, derived ON-DEMAND from the
// active WS sessions (no separate map / ref-counting to drift). A character profile carries its
// ownerAccountId, so a connected character ⇒ its account is online; a session in an active round ⇒
// "in-run". Disconnected (grace-window) sessions don't count. Ids with no live session are omitted →
// the caller treats them as "offline". Only the caller's OWN friends are passed in, so presence is
// never exposed beyond confirmed friends. No world (tests / WS-less) → empty map → all offline.
function presenceOf(world, accountIds) {
  const want = new Set(accountIds || []);
  const out = {};
  if (!world || !world.sessions || want.size === 0) return out;
  for (const s of world.sessions.values()) {
    if (!s || s.disconnected) continue;
    const acc = s.profile && s.profile.ownerAccountId;
    if (!acc || !want.has(acc)) continue;
    if (out[acc] !== "in-run") out[acc] = (s.state === "in_round" ? "in-run" : "online"); // in-run wins over online
  }
  return out;
}

// Returns true if it handled the request (so index.js stops). Unknown /account/* → 404 JSON.
export async function handleAccountHttp(req, res, world) {
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

  // Unlink a sign-in method (TQ-61). POST { method: "google"|"discord"|"password" }. Session-gated;
  // the store guard refuses to remove the LAST remaining method (no lockout). Echoes the updated
  // providers. (Adding/linking a provider is the OAuth attach flow — TQ-62.)
  if (u.pathname === "/account/unlink") {
    const account = getAccountBySession(sessionOf(req));
    if (!account) { sendJson(res, 401, { error: "unauthorized" }); return true; }
    if ((req.method || "GET") !== "POST") { sendJson(res, 405, { error: "method_not_allowed" }); return true; }
    if (!writeLimiter.allow(clientIp(req))) { sendJson(res, 429, { error: "rate_limited" }); return true; }
    let body;
    try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: "bad_request" }); return true; }
    const r = accountUnlinkProvider(account, String((body && body.method) || ""));
    if (!r.ok) { sendJson(res, r.reason === "last_method" ? 409 : 400, { error: r.reason }); return true; }
    sendJson(res, 200, { ok: true, providers: serializeAccount(account).providers });
    return true;
  }

  // Change the native password while signed in (TQ-58). POST { currentPassword, newPassword } — the
  // session identifies the account, and re-auth with the current password gates this sensitive change.
  // The session token is independent of the password, so the user stays logged in after the change.
  if (u.pathname === "/account/password") {
    const account = getAccountBySession(sessionOf(req));
    if (!account) { sendJson(res, 401, { error: "unauthorized" }); return true; }
    if ((req.method || "GET") !== "POST") { sendJson(res, 405, { error: "method_not_allowed" }); return true; }
    if (!writeLimiter.allow(clientIp(req))) { sendJson(res, 429, { error: "rate_limited" }); return true; }
    let body;
    try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: "bad_request" }); return true; }
    if (!account.passwordHash) { sendJson(res, 400, { error: "no_password" }); return true; } // OAuth-only account: nothing to change
    if (!verifyPassword(body && body.currentPassword, account.passwordHash)) { sendJson(res, 401, { error: "invalid_credentials" }); return true; }
    const pwOk = validatePassword(body && body.newPassword);
    if (!pwOk.ok) { sendJson(res, 400, { error: "weak_password", message: pwOk.reason }); return true; }
    accountSetPassword(account, hashPassword(body.newPassword));
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Permanently delete the account + all owned characters/match history (right to be forgotten, TQ-11).
  // POST /account/delete — no body; the session is invalidated server-side, so the client signs out.
  if (u.pathname === "/account/delete") {
    const account = getAccountBySession(sessionOf(req));
    if (!account) { sendJson(res, 401, { error: "unauthorized" }); return true; }
    if ((req.method || "GET") !== "POST") { sendJson(res, 405, { error: "method_not_allowed" }); return true; }
    if (!writeLimiter.allow(clientIp(req))) { sendJson(res, 429, { error: "rate_limited" }); return true; }
    deleteAccount(account);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // ── Friends (TQ-73) ── account-session-gated social endpoints over the TQ-72 model. The shareable
  // "friend code" IS the stable account id (returned by /account/me as `id`) — no nickname collisions
  // or enumeration; requests target it. Views are SAFE (id + nickname only — never email). Writes are
  // rate-limited + size-capped like the rest. Online/in-run status is layered on in TQ-74.
  if (u.pathname === "/account/friends" || u.pathname.startsWith("/account/friends/")) {
    const account = getAccountBySession(sessionOf(req));
    if (!account) { sendJson(res, 401, { error: "unauthorized" }); return true; }
    const method = req.method || "GET";
    const view = (id) => { const a = getAccountById(id); return { id, nickname: a ? (a.nickname || "Tamer") : "Unknown" }; };

    // GET /account/friends → friends + pending requests, each with live presence (TQ-74).
    if (u.pathname === "/account/friends" && method === "GET") {
      const reqs = listRequests(account);
      const friendIds = listFriends(account);
      const presence = presenceOf(world, [...friendIds, ...reqs.incoming, ...reqs.outgoing]);
      const viewS = (id) => { const a = getAccountById(id); return { id, nickname: a ? (a.nickname || "Tamer") : "Unknown", status: presence[id] || "offline" }; };
      sendJson(res, 200, {
        friends: friendIds.map(viewS),
        incoming: reqs.incoming.map(viewS),
        outgoing: reqs.outgoing.map(viewS),
      });
      return true;
    }

    // Every remaining friend route mutates → rate-limit + parse a small { id } body.
    if (!writeLimiter.allow(clientIp(req))) { sendJson(res, 429, { error: "rate_limited" }); return true; }
    let body;
    try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: "bad_request" }); return true; }
    const id = String((body && body.id) || "").trim();
    if (!id) { sendJson(res, 400, { error: "invalid_id" }); return true; }

    if (u.pathname === "/account/friends/request" && method === "POST") {
      const r = sendFriendRequest(account, id);
      // store result code → [httpStatus, errorOrNull]
      const map = {
        sent: [200], friends: [200], self: [400, "self"], unknown: [404, "not_found"],
        blocked: [409, "blocked"], exists: [409, "already_friends"], pending: [409, "already_pending"], full: [409, "limit_reached"],
      };
      const [code, err] = map[r] || [400, "bad_request"];
      sendJson(res, code, err ? { error: err } : { ok: true, status: r });
      return true;
    }
    if (u.pathname === "/account/friends/accept" && method === "POST") {
      if (!acceptFriendRequest(account, id)) { sendJson(res, 404, { error: "no_request" }); return true; }
      sendJson(res, 200, { ok: true, friends: listFriends(account).map(view) });
      return true;
    }
    if (u.pathname === "/account/friends/decline" && method === "POST") {
      if (!declineFriendRequest(account, id)) { sendJson(res, 404, { error: "no_request" }); return true; }
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (u.pathname === "/account/friends" && method === "DELETE") {
      if (!removeFriend(account, id)) { sendJson(res, 404, { error: "not_friends" }); return true; }
      sendJson(res, 200, { ok: true, friends: listFriends(account).map(view) });
      return true;
    }
    if (u.pathname === "/account/friends/block" && method === "POST") {
      if (!blockAccount(account, id)) { sendJson(res, 400, { error: "bad_request" }); return true; }
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (u.pathname === "/account/friends/unblock" && method === "POST") {
      if (!unblockAccount(account, id)) { sendJson(res, 404, { error: "not_blocked" }); return true; }
      sendJson(res, 200, { ok: true });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  sendJson(res, 404, { error: "not_found" });
  return true;
}
