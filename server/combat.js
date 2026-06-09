// Server-side combat resolution (FGT-T1 / PARITY-1). Combat is AI-ONLY: every turn
// is owned by the judge LLM (server/ai.js) in BOTH single-player and multiplayer,
// routed through ONE shared resolver (`aiTurn`). The deterministic engine
// (engine/combat.js) is NO LONGER a gameplay path — it is kept ONLY as a transient
// crash-net so a single hung/failed AI call (the CB-3 10s abort) doesn't freeze a
// fight. Whether combat is *available at all* is gated on `aiEnabled()` upstream
// (no key → the client shows "combat needs connection", never a silent det. fight).
//
// SP reaches this same path over HTTP (see handleCombatHttp / resolveTurnRequest);
// MP reaches it over WS (resolveCombatAction / pvp.js). Same buildState + aiTurn for
// both, so SP and MP resolve identical inputs identically.

import { getMonsterType, getAttacksForMonster, getSpiritChain } from "../src/engine/gamedata.js";
import { getMonsterStats } from "../src/engine/stats.js";
import { resolveTurn, resolveCatch } from "../src/engine/combat.js";
import { makeRng, randomSeed } from "../src/engine/rng.js";
import { GAME } from "../src/engine/schemas.js";
import { grantXp } from "../src/engine/progression.js";
import { aiEnabled, aiResolveTurn } from "./ai.js";
import { createIpRateLimiter, clientIp } from "./ratelimit.js";

// Defense-in-depth for the unauthenticated, AI-COST /api/combat/turn endpoint: a
// generous per-IP token bucket so a naive flood from one source can't run up the OpenAI
// bill. Real combat is ~one turn / few seconds, so 30 burst + 1/s refill never trips for
// legit play (even a few players behind one NAT). See ratelimit.js for the trust caveats
// (x-forwarded-for is spoofable; the robust fix is auth-gating the endpoint — FGT/SEC follow-up).
const combatTurnLimiter = createIpRateLimiter({ capacity: 30, refillPerSec: 1 });

// THE shared combat-turn resolver — the AI judge owns the turn. The deterministic
// engine is ONLY a transient crash-net: when a key IS set but a single call fails
// or times out, we resolve that one turn offline so the fight doesn't freeze (NOT a
// normal gameplay path — combat is gated on aiEnabled() before it ever starts, so
// the no-key branch here is reached only by tests/misconfiguration and stays offline
// rather than hammering the API with a bad key). All callers (MP PvE/PvP + the SP
// HTTP endpoint) go through this one function, so SP and MP can't drift.
export async function aiTurn({ player, playerAttack, enemy, enemyAttack, initiator = null, rng = null }) {
  if (aiEnabled()) {
    try {
      return await aiResolveTurn({ player, playerAttack, enemy, enemyAttack, initiator });
    } catch (e) {
      console.error("[combat] AI turn failed — crash-net engine for one turn:", e.message);
    }
  }
  return resolveTurn({ rng: rng || makeRng(randomSeed()), player, playerAttack, enemy, enemyAttack, initiator });
}

// Normalize a monster instance into the engine's combatant shape.
export function buildState(inst) {
  const mt = getMonsterType(inst.typeName);
  const st = getMonsterStats(mt, inst.level);
  return {
    name: inst.name || inst.typeName,
    element: mt?.element || null, // guard a missing/deleted type (matches monSnap + getMonsterStats); null → neutral matchups, not a crash
    currentHealth: inst.currentHealth,
    maxHealth: st.health,
    currentEnergy: inst.currentEnergy,
    maxEnergy: st.energy,
    strength: st.strength,
    defense: st.defense,
    speed: st.speed,
    power: st.power,
    luck: st.luck,
    status: inst.status || null,
  };
}

// Q8: a "breather" between encounters — restore a fraction of max energy to a
// monster so a depleted team isn't permanently stuck skipping turns (the engine
// makes a monster skip when it can't afford any attack). Never reduces; capped at
// max. Returns the new energy.
export function restoreEnergyPartial(inst, pct = 50) {
  const st = getMonsterStats(getMonsterType(inst.typeName), inst.level);
  const add = Math.ceil((st.energy * pct) / 100);
  inst.currentEnergy = Math.min(st.energy, (inst.currentEnergy || 0) + add);
  return inst.currentEnergy;
}

// A full-HP wild enemy instance from a map monster entry.
export function makeEnemy(entry) {
  const mt = getMonsterType(entry.typeName);
  const st = getMonsterStats(mt, entry.level);
  return {
    typeName: entry.typeName,
    name: entry.typeName,
    level: entry.level,
    xp: 0,
    currentHealth: st.health,
    currentEnergy: st.energy,
    status: null,
  };
}

export function attacksFor(inst) {
  return getAttacksForMonster(getMonsterType(inst.typeName)).map((a) => ({
    name: a.name,
    energyCost: a.energyCost,
    element: a.elementalType,
  }));
}

// Anti-cheat: resolve a requested attack ONLY if it belongs to the acting monster.
// Clients can name any attack in the game data; never honor an off-roster one.
// Unknown/unowned → null, which the resolver treats as a skipped turn.
export function ownedAttack(inst, name) {
  if (!name) return null;
  return getAttacksForMonster(getMonsterType(inst.typeName)).find((a) => a.name === name) || null;
}

function chooseEnemyAttack(inst, rng) {
  const all = getAttacksForMonster(getMonsterType(inst.typeName));
  const affordable = all.filter((a) => a.energyCost <= inst.currentEnergy);
  if (!affordable.length) return null;
  return affordable[Math.floor(rng.next() * affordable.length)];
}

function monSnap(inst) {
  const mt = getMonsterType(inst.typeName);
  const st = getMonsterStats(mt, inst.level);
  return {
    id: inst.id, // FGT-T4: lets the MP overlay identify the active monster + send a swap target by id
    name: inst.name || inst.typeName,
    typeName: inst.typeName,
    element: mt?.element || null,
    level: inst.level,
    currentHealth: inst.currentHealth,
    maxHealth: st.health,
    currentEnergy: inst.currentEnergy,
    maxEnergy: st.energy,
    status: inst.status || null,
  };
}


function advanceOrLose(session, narrative) {
  const next = session.team.findIndex((m, i) => i !== session.activeIdx && m.currentHealth > 0);
  if (next < 0) {
    return { narrative: narrative + " Your last monster fainted!", outcome: "lost", active: monSnap(session.team[session.activeIdx]), enemy: null };
  }
  session.activeIdx = next;
  return {
    narrative: narrative + ` ${session.team[next].name || session.team[next].typeName} steps in!`,
    switched: true,
    active: monSnap(session.team[next]),
  };
}

// Resolve one combat action. Mutates the session's team / enemy in place.
// Returns { narrative, active, enemy, switched?, outcome?, caught? }.
export async function resolveCombatAction(session, action, rng) {
  const pm = session.team[session.activeIdx];
  const enemy = session.enemy;

  // Initiative (from a thrown chain) applies to the first action only.
  const initiator = session.initiator || null;
  session.initiator = null;

  if (action.kind === "flee") {
    return { narrative: "You fled the battle.", outcome: "fled" };
  }

  if (action.kind === "catch") {
    const def = session.chainId ? getSpiritChain(session.chainId) : null;
    const skipEnemyAttack = initiator === "player";
    const catchOpts = def
      ? {
          captureMultiplier: def.captureMultiplier,
          maxRarity: def.maxRarity,
          enemyRarity: getMonsterType(enemy.typeName)?.rarity ?? 0,
          guaranteed: def.special === "guaranteed",
          skipEnemyAttack,
        }
      : { skipEnemyAttack };
    const r = resolveCatch({ rng, player: buildState(pm), enemy: buildState(enemy), enemyAttack: chooseEnemyAttack(enemy, rng), ...catchOpts });
    pm.currentHealth = r.player.currentHealth;
    pm.currentEnergy = r.player.currentEnergy;
    pm.status = r.player.status;
    if (r.caught) return { narrative: r.narrative, outcome: "caught", caught: monSnap(enemy) };
    if (pm.currentHealth <= 0) return advanceOrLose(session, r.narrative);
    return { narrative: r.narrative, active: monSnap(pm), enemy: monSnap(enemy) };
  }

  // SP/MP parity (FGT-T4): switch the active monster to another living team member.
  // A free action — matches SP fight.js doSwap (no enemy attack, initiative is NOT
  // consumed so a swap-then-attack keeps the first-turn edge). Target is given by
  // monster id (robust to client/server team-order skew); an invalid/dead/same target
  // is a no-op turn. The client sends { kind: "swap", monsterId }.
  if (action.kind === "swap") {
    session.initiator = initiator; // preserve first-turn initiative across the swap (SP parity)
    const team = session.team;
    const idx = team.findIndex((m) => m.id === action.monsterId && m.currentHealth > 0);
    if (idx < 0 || idx === session.activeIdx) {
      return { narrative: "Can't swap to that monster.", active: monSnap(pm), enemy: monSnap(enemy) };
    }
    session.activeIdx = idx;
    const nm = team[idx];
    return { narrative: `${nm.name || nm.typeName} steps in!`, switched: true, active: monSnap(nm), enemy: monSnap(enemy) };
  }

  // attack or skip — resolved by the shared AI-judge path (aiTurn). The session rng
  // seeds the crash-net only (a single failed AI call), never normal play. Anti-cheat:
  // only the active monster's own attacks are honored (unowned/unknown → null → skip).
  const atk = action.kind === "attack" ? ownedAttack(pm, action.attackName) : null;
  const enemyAtk = chooseEnemyAttack(enemy, rng);
  const pState = buildState(pm), eState = buildState(enemy);
  const r = await aiTurn({ player: pState, playerAttack: atk, enemy: eState, enemyAttack: enemyAtk, initiator, rng });
  pm.currentHealth = r.player.currentHealth;
  pm.currentEnergy = r.player.currentEnergy;
  pm.status = r.player.status;
  enemy.currentHealth = r.enemy.currentHealth;
  enemy.currentEnergy = r.enemy.currentEnergy;
  enemy.status = r.enemy.status;

  if (enemy.currentHealth <= 0) {
    const leveled = grantXp(pm, 20 + enemy.level * 10);
    return {
      narrative: r.narrative + " The wild monster was defeated!" + (leveled ? " Your monster leveled up!" : ""),
      outcome: "won",
      active: monSnap(pm),
      enemy: monSnap(enemy),
    };
  }
  if (pm.currentHealth <= 0) return advanceOrLose(session, r.narrative);
  return { narrative: r.narrative, active: monSnap(pm), enemy: monSnap(enemy) };
}

// ─── Single-player combat over HTTP (FGT-T1 / PARITY-1) ───
// SP runs in the browser with no API key, so it routes ONE turn through the server's
// AI judge via this endpoint — the exact same buildState + aiTurn path MP uses, so SP
// and MP resolve identical inputs identically. The client sends monster INSTANCES
// (typeName/level/current*) + the chosen attack names; the server derives stats
// (buildState) and validates attacks (ownedAttack) authoritatively. Catch stays the
// shared deterministic chain mechanic (engine resolveCatch) — it's not an LLM call —
// and is resolved locally by both SP and MP, so only the turn needs this round-trip.
export async function resolveTurnRequest(body) {
  const player = body && body.player, enemy = body && body.enemy;
  if (!player || !player.typeName || !enemy || !enemy.typeName) throw new Error("bad combatants");
  const pState = buildState(player), eState = buildState(enemy);
  const atk = ownedAttack(player, body.playerAttackName);
  // The enemy's move: honor the client's chosen (own) attack if valid, else pick one
  // server-side — either way it's resolved identically by aiTurn.
  const enemyAtk = ownedAttack(enemy, body.enemyAttackName) || chooseEnemyAttack(enemy, makeRng(randomSeed()));
  const initiator = body.initiator === "player" || body.initiator === "enemy" ? body.initiator : null;
  const r = await aiTurn({ player: pState, playerAttack: atk, enemy: eState, enemyAttack: enemyAtk, initiator });
  return {
    player: { currentHealth: r.player.currentHealth, currentEnergy: r.player.currentEnergy, status: r.player.status },
    enemy: { currentHealth: r.enemy.currentHealth, currentEnergy: r.enemy.currentEnergy, status: r.enemy.status },
    narrative: r.narrative,
  };
}

// Read a small JSON request body (with a hard size cap so a giant POST can't OOM us).
function readJsonBody(req, max = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "", over = false;
    req.on("data", (c) => {
      if (over) return;
      data += c;
      if (data.length > max) { over = true; reject(new Error("payload too large")); }
    });
    req.on("end", () => { if (over) return; try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("bad json")); } });
    req.on("error", reject);
  });
}

// HTTP entry for SP combat. Returns true if it handled the request (so index.js can
// fall through to static serving otherwise). Owns /api/combat/*.
//   GET  /api/combat/status → { available: <AI judge configured?> }  (SP gates its
//        fight on this: false → "combat needs connection", not a silent det. fight)
//   POST /api/combat/turn   → resolve one turn via the shared AI path
// CORS origin for the AI-cost combat endpoint honoring the ALLOWED_ORIGINS allow-list
// (task 73). Empty list (combined deploy / SP dev on a Vite port) → "*" (unchanged). When
// set (cross-origin/split deploy), only a LISTED Origin is echoed; anything else gets the
// canonical origin → the browser blocks the mismatch. Same-origin prod is never affected.
const CORS_ALLOW = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
function corsOrigin(req) {
  if (!CORS_ALLOW.length) return "*";
  const origin = req.headers && req.headers.origin;
  return origin && CORS_ALLOW.includes(origin) ? origin : CORS_ALLOW[0];
}

export async function handleCombatHttp(req, res) {
  if (!req.url || !req.url.startsWith("/api/combat/")) return false;
  // CORS: SP dev runs the client on a different port (Vite) than the server, so allow
  // cross-origin + answer the preflight. Same-origin in prod is unaffected. The allow-list
  // (ALLOWED_ORIGINS) governs this AI-cost endpoint once a split deploy is used (task 73).
  res.setHeader("Access-Control-Allow-Origin", corsOrigin(req));
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return true; }

  if (req.url === "/api/combat/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ available: aiEnabled() }));
    return true;
  }

  if (req.url === "/api/combat/turn" && req.method === "POST") {
    // AI judge offline → 503 so the client shows "combat needs connection" rather than
    // falling back to a silent deterministic fight (the FGT-T1 directive).
    if (!aiEnabled()) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "ai_unavailable" }));
      return true;
    }
    // Per-IP flood guard before we spend money on an AI call.
    if (!combatTurnLimiter.allow(clientIp(req))) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "rate_limited" }));
      return true;
    }
    try {
      const body = await readJsonBody(req);
      const out = await resolveTurnRequest(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
    } catch (e) {
      const bad = /bad json|bad combatants|payload too large/.test(e.message);
      res.writeHead(bad ? 400 : 500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: bad ? "bad_request" : "resolve_failed" }));
    }
    return true;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
  return true;
}

export { monSnap };
