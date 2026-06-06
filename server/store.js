// Profile store — the persistence seam. In-memory implementation for now; P1-T2
// swaps in a Postgres-backed version behind this same interface (getByToken /
// createProfile / saveProfile) without touching the rest of the server.
//
// Anonymous players (decision Q6) get an opaque session token on first join; the
// client stores it and presents it on reconnect to resume the same profile.

import { randomSeed } from "../src/engine/rng.js";
import { createPlayerProfile, createMonsterInstance, GAME } from "../src/engine/schemas.js";
import { getMonsterTypes } from "../src/engine/gamedata.js";
import { getMonsterStats } from "../src/engine/stats.js";

const profiles = new Map(); // token -> PlayerProfile (with a .token field)
let counter = 1;

// Opaque, non-cryptographic id/token (fine for anonymous play; harden with real
// auth in the Google/Discord/native phases).
function rid(prefix) {
  return `${prefix}_${randomSeed().toString(36)}${(counter++).toString(36)}`;
}

// Roll a fresh base inventory: up to TEAM_SIZE distinct random Lv.1 starters.
// Server-authoritative (mirrors the old client-side character creation).
function rollStarters() {
  const types = getMonsterTypes();
  const team = [];
  const used = new Set();
  let guard = 0;
  while (team.length < Math.min(GAME.TEAM_SIZE, types.length) && guard++ < 200) {
    const mt = types[Math.floor(Math.random() * types.length)];
    if (used.has(mt.typeName)) continue;
    used.add(mt.typeName);
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

export function createProfile(nickname) {
  const token = rid("tk");
  const profile = createPlayerProfile({ id: rid("pl"), name: nickname });
  profile.activeMonsters = rollStarters();
  profile.token = token;
  profiles.set(token, profile);
  return profile;
}

export function getByToken(token) {
  return token ? profiles.get(token) || null : null;
}

export function saveProfile(profile) {
  if (profile && profile.token) profiles.set(profile.token, profile);
}

// Test/introspection helper.
export function profileCount() {
  return profiles.size;
}
