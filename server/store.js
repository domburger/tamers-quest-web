// Hot-path reads must stay sync (in-memory cache): awaiting reorders WS messages.

import { randomBytes, createHash } from "node:crypto";
import { randomSeed } from "../src/engine/rng.js";
import { createPlayerProfile, createMonsterInstance, grantStarterChains, grantStarterInventory, ensureChainSlots, GAME } from "../src/engine/schemas.js";
import { getMonsterTypes, getSpiritChain } from "../src/engine/gamedata.js";
import { getMonsterStats } from "../src/engine/stats.js";
import { initDb, dbEnabled, loadAllProfiles, upsertProfiles, closeDb, wipeProfiles, loadAllAccounts, upsertAccounts, wipeAccounts, deleteProfileRow, deleteAccountRow } from "./db.js";

const profiles = new Map();
const dirty = new Set();
const FLUSH_MS = 3000;
let counter = 1;
let flushTimer = null;

// Predictable: uniqueness only; never use for session tokens or client-routed ids.
function rid(prefix) {
  return `${prefix}_${randomSeed().toString(36)}${(counter++).toString(36)}`;
}

function secureToken() {
  return `tk_${randomBytes(24).toString("hex")}`;
}

export function secureId(prefix) {
  return `${prefix}${randomBytes(9).toString("hex")}`;
}

// Use for every runtime monster: applyRoster dedups by id, so collisions vanish.
export function newMonsterId() {
  return rid("m");
}

export function rollStarters() {
  const types = getMonsterTypes();
  const team = [];
  const used = new Set();
  const family = (n) => String(n || "").replace(/\s+\d+$/, "").toLowerCase();
  const families = new Set();
  let guard = 0;
  while (team.length < Math.min(GAME.TEAM_SIZE, types.length) && guard++ < 200) {
    const mt = types[Math.floor(Math.random() * types.length)];
    if (used.has(mt.typeName)) continue;
    if (families.has(family(mt.typeName)) && guard < 150) continue;
    used.add(mt.typeName); families.add(family(mt.typeName));
    team.push(
      createMonsterInstance({
        typeName: mt.typeName,
        level: 1,
        stats: getMonsterStats(mt, 1),
        id: rid("m"),
      })
    );
  }
  return team;
}

export function createProfile(nickname, { isGuest = false } = {}) {
  const token = secureToken();
  const profile = createPlayerProfile({ id: rid("pl"), name: nickname, isGuest });
  profile.activeMonsters = rollStarters();
  grantStarterInventory(profile, getSpiritChain);
  profile.token = token;
  profiles.set(token, profile);
  dirty.add(token);
  return profile;
}

export function getByToken(token) {
  if (!token) return null;
  const profile = profiles.get(token);
  if (!profile) return null;
  if (!Array.isArray(profile.chains) || !profile.equippedChainId) {
    grantStarterChains(profile, getSpiritChain);
    dirty.add(token);
  }
  if (!Array.isArray(profile.equippedChainIds) || profile.equippedChainIds.length === 0) {
    ensureChainSlots(profile);
    dirty.add(token);
  }
  if (!profile.essencePremium) {
    profile.essence = 0;
    profile.essencePremium = true;
    dirty.add(token);
  }
  return profile;
}

export function saveProfile(profile) {
  if (profile && profile.token) {
    profiles.set(profile.token, profile);
    dirty.add(profile.token);
  }
}

export function findByOAuth(provider, providerId) {
  if (!provider || !providerId) return null;
  const field = `${provider}Id`;
  for (const p of profiles.values()) if (p[field] === providerId) return p;
  return null;
}

export function linkOAuth(profile, provider, providerId, email) {
  if (!profile || !provider || !providerId) return profile;
  profile[`${provider}Id`] = String(providerId);
  if (email && !profile.email) profile.email = email;
  if (profile.isGuest) profile.isGuest = false;
  saveProfile(profile);
  return profile;
}

export function findByEmail(email) {
  if (!email) return null;
  for (const p of profiles.values()) if (p.email === email && p.passwordHash) return p;
  return null;
}

export function createAccount(email, passwordHash, nickname) {
  const profile = createProfile(nickname || "Tamer", { isGuest: false });
  profile.email = email;
  profile.passwordHash = passwordHash;
  saveProfile(profile);
  return profile;
}

export function claimAccount(token, email, passwordHash) {
  const profile = token && profiles.get(token);
  if (!profile || profile.passwordHash) return null;
  profile.email = email;
  profile.passwordHash = passwordHash;
  profile.isGuest = false;
  saveProfile(profile);
  return profile;
}

export function claimOAuth(token, provider, providerId, email) {
  const profile = token && profiles.get(token);
  if (!profile || profile[`${provider}Id`]) return null;
  return linkOAuth(profile, provider, providerId, email);
}

const accounts = new Map();
const dirtyAccounts = new Set();

function markAccountDirty(a) {
  if (a && a.sessionToken) { accounts.set(a.sessionToken, a); dirtyAccounts.add(a.sessionToken); }
}

export function createAccountRecord({ email = null, passwordHash = null, googleId = null, discordId = null, nickname = "Tamer", usernameChosen = false } = {}) {
  const a = {
    id: rid("ac"),
    sessionToken: secureToken(),
    email: email ? String(email).toLowerCase() : null,
    passwordHash: passwordHash || null,
    emailVerified: !!(googleId || discordId),
    googleId: googleId ? String(googleId) : null,
    discordId: discordId ? String(discordId) : null,
    nickname: String(nickname || "Tamer").slice(0, 24),
    usernameChosen: !!usernameChosen,
    characterTokens: [],
    // Store account ids only, never sessionTokens (those are credentials).
    friends: [],
    incomingRequests: [],
    outgoingRequests: [],
    blocked: [],
    isAccount: true,
  };
  markAccountDirty(a);
  return a;
}

export function accountSetNickname(account, name) {
  if (!account) return null;
  const clean = String(name || "").trim().slice(0, 24);
  if (clean) account.nickname = clean;
  account.usernameChosen = true;
  markAccountDirty(account);
  return account.nickname;
}

export function accountSetPassword(account, passwordHash) {
  if (!account || !passwordHash) return false;
  account.passwordHash = passwordHash;
  markAccountDirty(account);
  return true;
}

// Store only sha256(token), never the raw token; single-use + TTL.
const passwordResets = new Map();
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const sha256hex = (s) => createHash("sha256").update(String(s)).digest("hex");

export function issuePasswordReset(account, now = Date.now()) {
  if (!account || !account.id) return null;
  for (const [h, r] of passwordResets) if (r.expiresAt <= now) passwordResets.delete(h);
  const raw = `pr_${randomBytes(24).toString("hex")}`;
  passwordResets.set(sha256hex(raw), { accountId: account.id, expiresAt: now + PASSWORD_RESET_TTL_MS });
  return raw;
}

export function consumePasswordReset(rawToken, now = Date.now()) {
  if (!rawToken) return null;
  const h = sha256hex(rawToken);
  const rec = passwordResets.get(h);
  if (!rec) return null;
  passwordResets.delete(h);
  if (rec.expiresAt <= now) return null;
  return getAccountById(rec.accountId) || null;
}

export function accountMarkEmailVerified(account) {
  if (!account) return false;
  account.emailVerified = true;
  markAccountDirty(account);
  return true;
}
const emailVerifications = new Map();
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

export function issueEmailVerification(account, now = Date.now()) {
  if (!account || !account.id) return null;
  for (const [h, r] of emailVerifications) if (r.expiresAt <= now) emailVerifications.delete(h);
  const raw = `ev_${randomBytes(24).toString("hex")}`;
  emailVerifications.set(sha256hex(raw), { accountId: account.id, expiresAt: now + EMAIL_VERIFY_TTL_MS });
  return raw;
}

export function consumeEmailVerification(rawToken, now = Date.now()) {
  if (!rawToken) return null;
  const h = sha256hex(rawToken);
  const rec = emailVerifications.get(h);
  if (!rec) return null;
  emailVerifications.delete(h);
  if (rec.expiresAt <= now) return null;
  return getAccountById(rec.accountId) || null;
}

export function getAccountBySession(sessionToken) {
  return sessionToken ? accounts.get(sessionToken) || null : null;
}

export function findAccountByEmail(email) {
  if (!email) return null;
  const e = String(email).toLowerCase();
  for (const a of accounts.values()) if (a.email === e && a.passwordHash) return a;
  return null;
}

export function findAccountByOAuth(provider, providerId) {
  if (!provider || !providerId) return null;
  const field = `${provider}Id`, id = String(providerId);
  for (const a of accounts.values()) if (a[field] === id) return a;
  return null;
}

// Exclude native-only accounts: their email is unverified (auto-link = takeover).
export function findAccountByVerifiedEmail(email) {
  if (!email) return null;
  const e = String(email).toLowerCase();
  for (const a of accounts.values()) if (a.email === e && (a.googleId || a.discordId)) return a;
  return null;
}

export function accountLinkProvider(account, provider, providerId, email) {
  if (!account || !provider || !providerId) return account;
  account[`${provider}Id`] = String(providerId);
  if (email && !account.email) account.email = String(email).toLowerCase();
  markAccountDirty(account);
  return account;
}

export function accountMethodCount(account) {
  if (!account) return 0;
  return (account.googleId ? 1 : 0) + (account.discordId ? 1 : 0) + (account.passwordHash ? 1 : 0);
}

const UNLINK_FIELD = { google: "googleId", discord: "discordId", password: "passwordHash" };

export function accountUnlinkProvider(account, method) {
  if (!account) return { ok: false, reason: "invalid_method" };
  const field = UNLINK_FIELD[method];
  if (!field) return { ok: false, reason: "invalid_method" };
  if (!account[field]) return { ok: false, reason: "not_linked" };
  if (accountMethodCount(account) <= 1) return { ok: false, reason: "last_method" };
  account[field] = null;
  markAccountDirty(account);
  return { ok: true };
}

export function accountAttachProvider(account, provider, providerId, email) {
  if (!account || !(provider in UNLINK_FIELD) || provider === "password" || !providerId) return { ok: false, reason: "invalid" };
  const existing = findAccountByOAuth(provider, providerId);
  if (existing && existing.id !== account.id) return { ok: false, reason: "conflict" };
  accountLinkProvider(account, provider, providerId, email);
  return { ok: true };
}

export function accountAddCharacter(account, name, { maxSlots = 5 } = {}) {
  if (!account) return null;
  account.characterTokens = (account.characterTokens || []).filter((t) => profiles.has(t));
  if (account.characterTokens.length >= maxSlots) return null;
  const profile = createProfile(name || account.nickname || "Tamer", { isGuest: false });
  profile.name = String(name || account.nickname || "Tamer").slice(0, 24);
  profile.ownerAccountId = account.id;
  saveProfile(profile);
  account.characterTokens.push(profile.token);
  markAccountDirty(account);
  return profile;
}

export function accountCharacters(account) {
  if (!account) return [];
  return (account.characterTokens || []).map((t) => profiles.get(t)).filter(Boolean);
}

export function accountRemoveCharacter(account, token) {
  if (!account || !token || !(account.characterTokens || []).includes(token)) return false;
  account.characterTokens = account.characterTokens.filter((t) => t !== token);
  markAccountDirty(account);
  deleteProfile(token);
  return true;
}

export function deleteAccount(account) {
  if (!account) return 0;
  const tokens = [...(account.characterTokens || [])];
  for (const t of tokens) deleteProfile(t);
  account.characterTokens = [];
  accounts.delete(account.sessionToken);
  dirtyAccounts.delete(account.sessionToken);
  deleteAccountRow(account.sessionToken).catch((e) => console.error("[store] deleteAccount:", e.message));
  return tokens.length;
}

export function deleteProfile(token) {
  if (!token) return;
  profiles.delete(token);
  dirty.delete(token);
  deleteProfileRow(token).catch((e) => console.error("[store] deleteProfile:", e.message));
}

export function accountAttachExistingCharacter(account, profile) {
  if (!account || !profile || !profile.token) return false;
  account.characterTokens = account.characterTokens || [];
  if (!account.characterTokens.includes(profile.token)) account.characterTokens.push(profile.token);
  profile.ownerAccountId = account.id;
  if (!profile.name) profile.name = account.nickname || "Tamer";
  if (profile.isGuest) profile.isGuest = false;
  saveProfile(profile);
  markAccountDirty(account);
  return true;
}

export function migrateProfileToAccount(profile) {
  if (!profile) return null;
  const account = createAccountRecord({
    email: profile.email, passwordHash: profile.passwordHash,
    googleId: profile.googleId, discordId: profile.discordId,
    nickname: profile.name || "Tamer",
    usernameChosen: true,
  });
  accountAttachExistingCharacter(account, profile);
  return account;
}

export function getAccountById(id) {
  if (!id) return null;
  for (const a of accounts.values()) if (a.id === id) return a;
  return null;
}

export function ensureAccountForProfile(profile) {
  if (!profile) return null;
  if (profile.ownerAccountId) {
    const existing = getAccountById(profile.ownerAccountId);
    if (existing) return existing;
  }
  const existing =
    (profile.email && findAccountByEmail(profile.email)) ||
    (profile.googleId && findAccountByOAuth("google", profile.googleId)) ||
    (profile.discordId && findAccountByOAuth("discord", profile.discordId));
  if (existing) { accountAttachExistingCharacter(existing, profile); return existing; }
  return migrateProfileToAccount(profile);
}

export function accountCount() {
  return accounts.size;
}

export const MAX_FRIENDS = 200;
export const MAX_PENDING_REQUESTS = 100;

function ensureSocial(a) {
  if (!a) return a;
  if (!Array.isArray(a.friends)) a.friends = [];
  if (!Array.isArray(a.incomingRequests)) a.incomingRequests = [];
  if (!Array.isArray(a.outgoingRequests)) a.outgoingRequests = [];
  if (!Array.isArray(a.blocked)) a.blocked = [];
  return a;
}

const withoutId = (arr, id) => arr.filter((x) => x !== id);

export function sendFriendRequest(account, toId) {
  if (!account || !toId) return "unknown";
  ensureSocial(account);
  if (toId === account.id) return "self";
  const to = getAccountById(toId);
  if (!to) return "unknown";
  ensureSocial(to);
  if (account.blocked.includes(toId) || to.blocked.includes(account.id)) return "blocked";
  if (account.friends.includes(toId)) return "exists";
  if (account.incomingRequests.includes(toId)) { acceptFriendRequest(account, toId); return "friends"; }
  if (account.outgoingRequests.includes(toId)) return "pending";
  if (account.outgoingRequests.length >= MAX_PENDING_REQUESTS || to.incomingRequests.length >= MAX_PENDING_REQUESTS) return "full";
  account.outgoingRequests.push(toId);
  if (!to.incomingRequests.includes(account.id)) to.incomingRequests.push(account.id);
  markAccountDirty(account);
  markAccountDirty(to);
  return "sent";
}

export function acceptFriendRequest(account, fromId) {
  if (!account || !fromId) return false;
  ensureSocial(account);
  if (!account.incomingRequests.includes(fromId)) return false;
  account.incomingRequests = withoutId(account.incomingRequests, fromId);
  if (!account.friends.includes(fromId) && account.friends.length < MAX_FRIENDS) account.friends.push(fromId);
  const other = getAccountById(fromId);
  if (other) {
    ensureSocial(other);
    other.outgoingRequests = withoutId(other.outgoingRequests, account.id);
    if (!other.friends.includes(account.id) && other.friends.length < MAX_FRIENDS) other.friends.push(account.id);
    markAccountDirty(other);
  }
  markAccountDirty(account);
  return true;
}

export function declineFriendRequest(account, fromId) {
  if (!account || !fromId) return false;
  ensureSocial(account);
  if (!account.incomingRequests.includes(fromId)) return false;
  account.incomingRequests = withoutId(account.incomingRequests, fromId);
  const other = getAccountById(fromId);
  if (other) { ensureSocial(other); other.outgoingRequests = withoutId(other.outgoingRequests, account.id); markAccountDirty(other); }
  markAccountDirty(account);
  return true;
}

export function removeFriend(account, otherId) {
  if (!account || !otherId) return false;
  ensureSocial(account);
  if (!account.friends.includes(otherId)) return false;
  account.friends = withoutId(account.friends, otherId);
  const other = getAccountById(otherId);
  if (other) { ensureSocial(other); other.friends = withoutId(other.friends, account.id); markAccountDirty(other); }
  markAccountDirty(account);
  return true;
}

export function blockAccount(account, otherId) {
  if (!account || !otherId || otherId === account.id) return false;
  ensureSocial(account);
  account.friends = withoutId(account.friends, otherId);
  account.incomingRequests = withoutId(account.incomingRequests, otherId);
  account.outgoingRequests = withoutId(account.outgoingRequests, otherId);
  if (!account.blocked.includes(otherId)) account.blocked.push(otherId);
  const other = getAccountById(otherId);
  if (other) {
    ensureSocial(other);
    other.friends = withoutId(other.friends, account.id);
    other.incomingRequests = withoutId(other.incomingRequests, account.id);
    other.outgoingRequests = withoutId(other.outgoingRequests, account.id);
    markAccountDirty(other);
  }
  markAccountDirty(account);
  return true;
}

export function unblockAccount(account, otherId) {
  if (!account || !otherId) return false;
  ensureSocial(account);
  if (!account.blocked.includes(otherId)) return false;
  account.blocked = withoutId(account.blocked, otherId);
  markAccountDirty(account);
  return true;
}

export function listFriends(account) { return account ? [...ensureSocial(account).friends] : []; }
export function listRequests(account) {
  if (!account) return { incoming: [], outgoing: [] };
  ensureSocial(account);
  return { incoming: [...account.incomingRequests], outgoing: [...account.outgoingRequests] };
}
export function isBlocked(account, otherId) {
  return !!account && ensureSocial(account).blocked.includes(otherId);
}

export function profileCount() {
  return profiles.size;
}

// Clear dirty too, or the flush loop resurrects wiped profiles.
export async function wipeAllProfiles() {
  const n = profiles.size;
  profiles.clear();
  dirty.clear();
  accounts.clear();
  dirtyAccounts.clear();
  await wipeProfiles().catch((e) => console.error("[store] wipe:", e.message));
  await wipeAccounts().catch((e) => console.error("[store] wipe accounts:", e.message));
  return n;
}

export function bumpStat(profile, key, n = 1) {
  if (!profile) return;
  profile.stats = profile.stats || {};
  profile.stats[key] = (profile.stats[key] || 0) + n;
}

export function topProfiles(stat, n = 10) {
  return [...profiles.values()]
    .map((p) => ({ name: p.name, value: (p.stats && p.stats[stat]) || 0 }))
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

export async function initStore() {
  const enabled = await initDb();
  if (!enabled) {
    console.log("[store] no DATABASE_URL — profiles are in-memory only (reset on redeploy)");
    return false;
  }
  const rows = await loadAllProfiles();
  for (const { token, data } of rows) profiles.set(token, data);
  const accts = await loadAllAccounts();
  for (const { sessionToken, data } of accts) accounts.set(sessionToken, data);
  console.log(`[store] persistence ON — loaded ${rows.length} profile(s) + ${accts.length} account(s) from Postgres`);
  flushTimer = setInterval(() => {
    flushStore().catch((e) => console.error("[store] flush:", e.message));
  }, FLUSH_MS);
  flushTimer.unref?.();
  return true;
}

export async function flushStore() {
  if (!dbEnabled() || (dirty.size === 0 && dirtyAccounts.size === 0)) return;
  if (dirty.size > 0) {
    const batch = [];
    for (const token of dirty) { const p = profiles.get(token); if (p) batch.push(p); }
    dirty.clear();
    try {
      await upsertProfiles(batch);
    } catch (e) {
      for (const p of batch) dirty.add(p.token);
      throw e;
    }
  }
  if (dirtyAccounts.size > 0) {
    const abatch = [];
    for (const tk of dirtyAccounts) { const a = accounts.get(tk); if (a) abatch.push(a); }
    dirtyAccounts.clear();
    try {
      await upsertAccounts(abatch);
    } catch (e) {
      for (const a of abatch) dirtyAccounts.add(a.sessionToken);
      throw e;
    }
  }
}

export async function shutdownStore() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  try {
    await flushStore();
  } catch (e) {
    console.error("[store] final flush:", e.message);
  }
  await closeDb();
}
