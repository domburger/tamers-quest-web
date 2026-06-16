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
import { resolveTurn } from "../src/engine/combat.js";
import { makeRng, randomSeed } from "../src/engine/rng.js";
import { grantXp } from "../src/engine/progression.js";
import { aiEnabled, aiResolveTurn, aiResolveCatch } from "./ai.js";
import { getAiConfig } from "./aiconfig.js"; // TQ-40: tag recorded turns v1/v2
import { recordTurn } from "./aiMetrics.js"; // TQ-40: fight-agent observability (latency / fallback / timeout)
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
export async function aiTurn({ player, playerAttack, enemy, enemyAttack, initiator = null, rng = null, transcript = null, itemAction = null }) {
  if (aiEnabled()) {
    // TQ-40 monitoring: time the judge call and record success/latency, or a fallback (+ whether it
    // was the AI_TIMEOUT_MS abort) when it throws. An item turn always uses v2 (see aiResolveTurn).
    const version = (getAiConfig("combatJudgeV2") || itemAction) ? "v2" : "v1";
    const t0 = Date.now();
    try {
      const res = await aiResolveTurn({ player, playerAttack, enemy, enemyAttack, initiator, transcript, itemAction });
      recordTurn({ ok: true, latencyMs: Date.now() - t0, version });
      return res;
    } catch (e) {
      const timeout = /abort|timeout/i.test(`${e && e.name} ${e && e.message}`);
      recordTurn({ ok: false, timeout, latencyMs: Date.now() - t0, version });
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
    // Carried for the v2 structured judge (combatJudgeV2) so passives are considered;
    // the v1 judge + deterministic engine ignore these, so this is additive.
    passiveEffect: mt?.passiveEffect || "",
    description: mt?.description || "",
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
    // Player-readable move description (AI-authored genAttacks + pool attacks both carry
    // one) — lets the combat UI explain what a move does, not just its name.
    description: a.description || "",
  }));
}

// Anti-cheat: resolve a requested attack ONLY if it belongs to the acting monster.
// Clients can name any attack in the game data; never honor an off-roster one.
// Unknown/unowned → null, which the resolver treats as a skipped turn.
export function ownedAttack(inst, name) {
  if (!name) return null;
  return getAttacksForMonster(getMonsterType(inst.typeName)).find((a) => a.name === name) || null;
}

// TQ-457: the enemy's "simple AI" — it picks UNIFORMLY at random among the moves it can
// currently afford (its own roster only), and skips its turn (null) when it can afford none.
// Deliberately simple (no targeting/threat model): the PvE challenge comes from the AI judge's
// resolution, not enemy move-selection. Exported so the round-loop contract is directly testable.
export function chooseEnemyAttack(inst, rng) {
  const all = getAttacksForMonster(getMonsterType(inst.typeName));
  if (!all.length) return null; // no attacks defined at all → nothing to choose
  const affordable = all.filter((a) => a.energyCost <= inst.currentEnergy);
  // TQ-508: when the enemy can't afford ANY move, return its CHEAPEST attack anyway so the resolver's
  // Struggle path (CB-5, performAttack) fires — a weak free hit — instead of the enemy silently "waiting".
  // Returning null here made an enemy STOP counter-attacking the instant it ran out of energy (it only
  // ever hit on the first turn or two, then waited every turn). The player already struggles when broke
  // (the engine downgrades an unaffordable move), so this restores parity: an exhausted enemy keeps fighting.
  const pool = affordable.length ? affordable : [all.reduce((m, a) => (a.energyCost < m.energyCost ? a : m), all[0])];
  return pool[Math.floor(rng.next() * pool.length)];
}

function monSnap(inst) {
  const mt = getMonsterType(inst.typeName);
  const st = getMonsterStats(mt, inst.level);
  return {
    id: inst.id, // FGT-T4: lets the MP overlay identify the active monster + send a swap target by id
    name: inst.name || inst.typeName,
    typeName: inst.typeName,
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

// ── PvE hard-sequential turn helpers (TQ-457) ─────────────────────────────────
function applyTurnStates(pm, enemy, r) {
  pm.currentHealth = r.player.currentHealth; pm.currentEnergy = r.player.currentEnergy; pm.status = r.player.status;
  enemy.currentHealth = r.enemy.currentHealth; enemy.currentEnergy = r.enemy.currentEnergy; enemy.status = r.enemy.status;
}
function pushTranscript(session, narrative) {
  if (narrative && typeof narrative === "string") { (session.transcript ||= []).push(narrative); if (session.transcript.length > 12) session.transcript.shift(); }
}
function wonResult(pm, enemy, narrative) {
  const leveled = grantXp(pm, 20 + enemy.level * 10);
  return { narrative: narrative + (leveled ? " Your monster leveled up!" : ""), outcome: "won", active: monSnap(pm), enemy: monSnap(enemy) };
}
// After ONE attack pass, return a terminal result if the fight ended (judge special-action, defeated
// wild monster, or fainted active monster), else null. The CODE kill-check here spares a defeated wild
// monster from retaliating: the player's pass returns 'won' before the enemy's pass is reached.
function passTerminal(session, pm, enemy, narrative, special) {
  if (special && special.end) {
    if (special.flee) return { narrative, outcome: "fled" };
    if (special.winner === "enemy") return advanceOrLose(session, narrative);
    return wonResult(pm, enemy, narrative);
  }
  if (enemy.currentHealth <= 0) return wonResult(pm, enemy, narrative + " The wild monster was defeated!");
  if (pm.currentHealth <= 0) return advanceOrLose(session, narrative);
  return null;
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
    // Catching is AI-evaluated (catchJudgeSystem): the equipped chain's authored `catchPrompt`
    // describes its binding power and the judge weighs it against the enemy's weakened state to
    // return caught (1/0) + a short line. There is NO rarity gate and NO capture formula. On a
    // missing key / AI failure we fail the throw SAFELY (no free catches, no crash) rather than
    // reintroducing a deterministic formula.
    const def = session.chainId ? getSpiritChain(session.chainId) : null;
    const skipEnemyAttack = initiator === "player";
    const eState = buildState(enemy);
    let caught = 0, narrative = `${enemy.name || enemy.typeName} slips loose of the chain.`;
    if (aiEnabled()) {
      try {
        const res = await aiResolveCatch({ chain: def, enemy: eState });
        caught = res.caught;
        narrative = res.text;
      } catch (e) {
        console.error("[combat] AI catch failed — throw missed:", e.message);
      }
    }
    if (caught) return { narrative, outcome: "caught", caught: monSnap(enemy) };
    // Failed catch: the wild monster gets a swing back, UNLESS the player struck first this round
    // (a chain-initiated ambush). Resolved by the SAME AI turn judge (no deterministic formula) —
    // the player's monster takes no action this round.
    if (!skipEnemyAttack && aiEnabled()) {
      try {
        const r = await aiTurn({ player: buildState(pm), playerAttack: null, enemy: eState, enemyAttack: chooseEnemyAttack(enemy, rng), initiator: "enemy", rng, transcript: session.transcript });
        pm.currentHealth = r.player.currentHealth;
        pm.currentEnergy = r.player.currentEnergy;
        pm.status = r.player.status;
        enemy.currentHealth = r.enemy.currentHealth;
        enemy.currentEnergy = r.enemy.currentEnergy;
        enemy.status = r.enemy.status;
        if (typeof r.narrative === "string" && r.narrative.trim()) narrative = `${narrative} ${r.narrative}`;
      } catch (e) {
        console.error("[combat] catch retaliation failed:", e.message);
      }
    }
    if (pm.currentHealth <= 0) return advanceOrLose(session, narrative);
    return { narrative, active: monSnap(pm), enemy: monSnap(enemy) };
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
  // ITEM use (plan "Decide general items"): the player uses an item INSTEAD of a monster attack;
  // it's judged like an attack from its description (always the v2 descriptive judge). The
  // world.js handler attaches the owned item as action.itemDef and consumes it once resolved.
  const itemDef = action.kind === "item" ? (action.itemDef || null) : null;
  if (action.kind === "item" && !itemDef) return { narrative: "That item can't be used.", active: monSnap(pm), enemy: monSnap(enemy) };
  const atk = action.kind === "attack" ? ownedAttack(pm, action.attackName) : null;

  // PvE HARD-SEQUENTIAL resolution (TQ-457): two SINGLE-ATTACKER judge passes. The first actor attacks
  // (judged + executed); the KILL is checked in CODE between passes, so a wild monster you defeat never
  // retaliates. Only if the defender survives does it respond. Each pass = one attacker → one target (the
  // other waits), so the judge prompt names who-attacks-whom unambiguously. The simple AI picks the
  // enemy's move at its pass time (post-first-pass energy). Order honours initiative: player-first by
  // default, enemy-first on an enemy-initiative ambush. Transcript accumulates across passes for the v2 judge.
  const playerPass = () => aiTurn({ player: buildState(pm), playerAttack: atk, enemy: buildState(enemy), enemyAttack: null, initiator: "player", rng, transcript: session.transcript, itemAction: itemDef });
  const enemyPass = () => aiTurn({ player: buildState(pm), playerAttack: null, enemy: buildState(enemy), enemyAttack: chooseEnemyAttack(enemy, rng), initiator: "enemy", rng, transcript: session.transcript });
  const order = initiator === "enemy" ? [["enemy", enemyPass], ["player", playerPass]] : [["player", playerPass], ["enemy", enemyPass]];

  let narrative = "";
  for (const [who, pass] of order) {
    const r = await pass();
    if (who === "player" && itemDef) session.usedItem = itemDef;
    pushTranscript(session, r.narrative);
    applyTurnStates(pm, enemy, r);
    if (r.narrative && r.narrative.trim()) narrative = narrative ? `${narrative} ${r.narrative}` : r.narrative;
    const terminal = passTerminal(session, pm, enemy, narrative, r.special);
    if (terminal) return terminal;
  }
  return { narrative, active: monSnap(pm), enemy: monSnap(enemy) };
}

// ─── Single-player combat over HTTP (FGT-T1 / PARITY-1) ───
// SP runs in the browser with no API key, so it routes ONE turn through the server's
// AI judge via this endpoint — the exact same buildState + aiTurn path MP uses, so SP
// and MP resolve identical inputs identically. The client sends monster INSTANCES
// (typeName/level/current*) + the chosen attack names; the server derives stats
// (buildState) and validates attacks (ownedAttack) authoritatively. Catching, like a turn, is
// AI-evaluated (resolveCombatAction's catch branch → aiResolveCatch) — there is no rarity gate
// or capture formula; the equipped chain's catchPrompt + the enemy's state drive the verdict.
export async function resolveTurnRequest(body) {
  const player = body && body.player, enemy = body && body.enemy;
  if (!player || !player.typeName || !enemy || !enemy.typeName) throw new Error("bad combatants");
  const pState = buildState(player), eState = buildState(enemy);
  const atk = ownedAttack(player, body.playerAttackName);
  const initiator = body.initiator === "player" || body.initiator === "enemy" ? body.initiator : null;
  // SP combat is stateless HTTP, so the client carries the running transcript (optional) for the
  // v2 judge; capped to the last 12 lines. Ignored by the v1 judge.
  const transcript = Array.isArray(body.transcript) ? body.transcript.slice(-12).map((s) => String(s)) : null;
  // Optional item use (the SP client carries its own items; description-judged like an attack).
  const itemAction = body.itemAction && typeof body.itemAction === "object"
    ? { name: String(body.itemAction.name || "").slice(0, 40), description: String(body.itemAction.description || "").slice(0, 240) } : null;
  const atkOrNull = itemAction ? null : atk; // an item use replaces the monster attack this turn

  // PvE HARD-SEQUENTIAL resolution — parity with MP resolveCombatAction (TQ-457). Two single-attacker
  // passes; the enemy responds only if it survives. Stateless: pState/eState carry HP/energy/status
  // across the passes (aiTurn copies its inputs, never mutates them).
  const applyR = (r) => {
    pState.currentHealth = r.player.currentHealth; pState.currentEnergy = r.player.currentEnergy; pState.status = r.player.status;
    eState.currentHealth = r.enemy.currentHealth; eState.currentEnergy = r.enemy.currentEnergy; eState.status = r.enemy.status;
  };
  const playerPass = () => aiTurn({ player: pState, playerAttack: atkOrNull, enemy: eState, enemyAttack: null, initiator: "player", transcript, itemAction });
  const enemyPass = () => aiTurn({ player: pState, playerAttack: null, enemy: eState, enemyAttack: ownedAttack(enemy, body.enemyAttackName) || chooseEnemyAttack({ ...enemy, currentEnergy: eState.currentEnergy }, makeRng(randomSeed())), initiator: "enemy", transcript });
  const order = initiator === "enemy" ? [enemyPass, playerPass] : [playerPass, enemyPass];

  let narrative = "", special;
  for (const pass of order) {
    const r = await pass();
    applyR(r);
    if (r.narrative && r.narrative.trim()) narrative = narrative ? `${narrative} ${r.narrative}` : r.narrative;
    if (r.special) special = r.special;
    if (pState.currentHealth <= 0 || eState.currentHealth <= 0 || (special && special.end)) break; // a downed monster doesn't respond
  }
  return {
    player: { currentHealth: pState.currentHealth, currentEnergy: pState.currentEnergy, status: pState.status ?? null },
    enemy: { currentHealth: eState.currentHealth, currentEnergy: eState.currentEnergy, status: eState.status ?? null },
    narrative,
    special: special || undefined, // v2 special-actions (SP client may act on it); undefined for v1
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
