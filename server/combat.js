import { getMonsterType, getAttacksForMonster, getSpiritChain } from "../src/engine/gamedata.js";
import { getMonsterStats } from "../src/engine/stats.js";
import { resolveTurn } from "../src/engine/combat.js";
import { makeRng, randomSeed } from "../src/engine/rng.js";
import { grantXp, xpForLevel } from "../src/engine/progression.js";
import { aiEnabled, aiResolveTurn, aiResolveCatch } from "./ai.js";
import { getAiConfig } from "./aiconfig.js";
import { recordTurn } from "./aiMetrics.js";
import { createIpRateLimiter, clientIp } from "./ratelimit.js";

const combatTurnLimiter = createIpRateLimiter({ capacity: 30, refillPerSec: 1 });

export async function aiTurn({ player, playerAttack, enemy, enemyAttack, initiator = null, rng = null, transcript = null, itemAction = null }) {
  if (aiEnabled()) {
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
    passiveEffect: mt?.passiveEffect || "",
    description: mt?.description || "",
  };
}

export function restoreEnergyPartial(inst, pct = 50) {
  const st = getMonsterStats(getMonsterType(inst.typeName), inst.level);
  const add = Math.ceil((st.energy * pct) / 100);
  inst.currentEnergy = Math.min(st.energy, (inst.currentEnergy || 0) + add);
  return inst.currentEnergy;
}

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
    damage: a.damage ?? null,
    description: a.description || "",
  }));
}

// Anti-cheat: honor only attacks on the acting monster's own roster.
export function ownedAttack(inst, name) {
  if (!name) return null;
  return getAttacksForMonster(getMonsterType(inst.typeName)).find((a) => a.name === name) || null;
}

export function chooseEnemyAttack(inst, rng) {
  const all = getAttacksForMonster(getMonsterType(inst.typeName));
  if (!all.length) return null;
  const affordable = all.filter((a) => a.energyCost <= inst.currentEnergy);
  const pool = affordable.length ? affordable : [all.reduce((m, a) => (a.energyCost < m.energyCost ? a : m), all[0])];
  return pool[Math.floor(rng.next() * pool.length)];
}

function monSnap(inst) {
  const mt = getMonsterType(inst.typeName);
  const st = getMonsterStats(mt, inst.level);
  return {
    id: inst.id,
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

export const ENERGY_REGEN_PER_ROUND = 0.2;
export function regenRoundEnergy(inst) {
  if (!inst || inst.currentHealth <= 0) return;
  const max = getMonsterStats(getMonsterType(inst.typeName), inst.level).energy || 0;
  if (max <= 0) return;
  inst.currentEnergy = Math.min(max, (inst.currentEnergy || 0) + Math.max(1, Math.round(max * ENERGY_REGEN_PER_ROUND)));
}
function applyTurnStates(pm, enemy, r) {
  pm.currentHealth = r.player.currentHealth; pm.currentEnergy = r.player.currentEnergy; pm.status = r.player.status;
  enemy.currentHealth = r.enemy.currentHealth; enemy.currentEnergy = r.enemy.currentEnergy; enemy.status = r.enemy.status;
}
function pushTranscript(session, narrative) {
  if (narrative && typeof narrative === "string") { (session.transcript ||= []).push(narrative); if (session.transcript.length > 12) session.transcript.shift(); }
}
function wonResult(pm, enemy, narrative) {
  const levelFrom = pm.level, amount = 20 + enemy.level * 10;
  const leveled = grantXp(pm, amount);
  const gains = { monsterId: pm.id, monster: pm.name || pm.typeName, xp: amount, levelFrom, levelTo: pm.level, xpNow: pm.xp || 0, xpNeed: xpForLevel(pm.level) };
  return { narrative: narrative + (leveled ? " Your monster leveled up!" : ""), outcome: "won", active: monSnap(pm), enemy: monSnap(enemy), gains };
}
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

export async function resolveCombatAction(session, action, rng) {
  const pm = session.team[session.activeIdx];
  const enemy = session.enemy;

  const initiator = session.initiator || null;
  session.initiator = null;

  if (action.kind === "flee") {
    return { narrative: "You fled the battle.", outcome: "fled" };
  }

  if (action.kind === "catch") {
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

  if (action.kind === "swap") {
    session.initiator = initiator;
    const team = session.team;
    const idx = team.findIndex((m) => m.id === action.monsterId && m.currentHealth > 0);
    if (idx < 0 || idx === session.activeIdx) {
      return { narrative: "Can't swap to that monster.", active: monSnap(pm), enemy: monSnap(enemy) };
    }
    session.activeIdx = idx;
    const nm = team[idx];
    return { narrative: `${nm.name || nm.typeName} steps in!`, switched: true, active: monSnap(nm), enemy: monSnap(enemy) };
  }

  const itemDef = action.kind === "item" ? (action.itemDef || null) : null;
  if (action.kind === "item" && !itemDef) return { narrative: "That item can't be used.", active: monSnap(pm), enemy: monSnap(enemy) };
  const atk = action.kind === "attack" ? ownedAttack(pm, action.attackName) : null;

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
  regenRoundEnergy(pm); regenRoundEnergy(enemy);
  return { narrative, active: monSnap(pm), enemy: monSnap(enemy) };
}

export async function resolveTurnRequest(body) {
  const player = body && body.player, enemy = body && body.enemy;
  if (!player || !player.typeName || !enemy || !enemy.typeName) throw new Error("bad combatants");
  const pState = buildState(player), eState = buildState(enemy);
  const atk = ownedAttack(player, body.playerAttackName);
  const initiator = body.initiator === "player" || body.initiator === "enemy" ? body.initiator : null;
  const transcript = Array.isArray(body.transcript) ? body.transcript.slice(-12).map((s) => String(s)) : null;
  const itemAction = body.itemAction && typeof body.itemAction === "object"
    ? { name: String(body.itemAction.name || "").slice(0, 40), description: String(body.itemAction.description || "").slice(0, 240) } : null;
  const atkOrNull = itemAction ? null : atk;

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
    if (pState.currentHealth <= 0 || eState.currentHealth <= 0 || (special && special.end)) break;
  }
  if (pState.currentHealth > 0 && eState.currentHealth > 0 && !(special && special.end)) {
    for (const st of [pState, eState]) { const max = st.maxEnergy || 0; if (max > 0) st.currentEnergy = Math.min(max, (st.currentEnergy || 0) + Math.max(1, Math.round(max * ENERGY_REGEN_PER_ROUND))); }
  }
  return {
    player: { currentHealth: pState.currentHealth, currentEnergy: pState.currentEnergy, status: pState.status ?? null },
    enemy: { currentHealth: eState.currentHealth, currentEnergy: eState.currentEnergy, status: eState.status ?? null },
    narrative,
    special: special || undefined,
  };
}

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

const CORS_ALLOW = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
function corsOrigin(req) {
  if (!CORS_ALLOW.length) return "*";
  const origin = req.headers && req.headers.origin;
  return origin && CORS_ALLOW.includes(origin) ? origin : CORS_ALLOW[0];
}

export async function handleCombatHttp(req, res) {
  if (!req.url || !req.url.startsWith("/api/combat/")) return false;
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
    if (!aiEnabled()) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "ai_unavailable" }));
      return true;
    }
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
