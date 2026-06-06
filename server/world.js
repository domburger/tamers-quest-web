// Authoritative world: sessions + lobby/matchmaking + concurrent rounds + tick.
// Imports the shared engine so client and server run identical rules.
// Flow: join (session) → queue → matchmaker forms a round (≤16, fresh seed) →
// roundStart → in-round movement/snapshots. Combat (P3), seeded-map spawns (P2),
// and DB persistence (P1-T2) plug in later behind the existing seams.

import { randomSeed, makeRng, hashString } from "../src/engine/rng.js";
import { GAME } from "../src/engine/schemas.js";
import { generateMap, findSpawnPoint } from "../src/engine/mapgen.js";
import { getByToken, createProfile, saveProfile, rollStarters } from "./store.js";
import { resolveCombatAction, makeEnemy, attacksFor, monSnap, restoreEnergyPartial } from "./combat.js";
import { getMonsterType } from "../src/engine/gamedata.js";
import { getMonsterStats } from "../src/engine/stats.js";

// Area-of-interest radii (world px) for snapshot filtering.
const AOI_RADIUS = 900; // visible monsters within this of a player
const REVEAL_RADIUS = 220; // hidden monsters only reveal within this (ambush)
const HIDDEN_MONSTER_PCT = 35; // ~this % of monsters start hidden (decision Q2)
const ENCOUNTER_RADIUS = 44; // walk within this of a monster to start a fight
const EXTRACT_RADIUS = 48; // step within this of a portal to extract
const STORM_DPS = 25; // active-monster HP lost per second outside the safe zone

export function createWorld({
  countdownTicks = 75,
  minPlayers = 1,
  roundDurationS = GAME.ROUND_DURATION_S,
  circleStartS = GAME.CIRCLE_START_S,
  portalIntervalS = GAME.PORTAL_INTERVAL_S,
} = {}) {
  return {
    cfg: { countdownTicks, minPlayers, roundDurationS, circleStartS, portalIntervalS },
    sessions: new Map(), // playerId -> { profile, ws, state:'idle'|'queued'|'in_round', roundId }
    queue: [], // playerIds awaiting a match, in arrival order
    formingAtTick: null, // tick the next round starts (countdown), or null when queue empty
    rounds: new Map(), // roundId -> { roundId, seed, phase, startedAtMs, players:Map(id->rp) }
    combats: new Map(), // combatId -> { combatId, playerId, roundId, team, activeIdx, enemy, ... }
    tick: 0,
    nextRound: 1,
    nextCombat: 1,
  };
}

export function handleMessage(world, conn, msg, send) {
  if (!msg || typeof msg.t !== "string") return;
  switch (msg.t) {
    case "hello":
      send(conn.ws, { t: "server_info", maxPlayers: GAME.MAX_PLAYERS, serverTime: Date.now() });
      break;

    case "join": {
      if (conn.playerId) return; // already authenticated on this connection
      // Resume by session token, or create a new anonymous profile (decision Q6).
      let profile = getByToken(msg.token);
      if (!profile) profile = createProfile(sanitizeNick(msg.nickname));
      if (world.sessions.has(profile.id)) {
        send(conn.ws, { t: "error", code: "already_connected", message: "Profile already connected." });
        return;
      }
      conn.playerId = profile.id;
      world.sessions.set(profile.id, { profile, ws: conn.ws, state: "idle", roundId: null });
      send(conn.ws, {
        t: "welcome", // session established
        you: { id: profile.id, nickname: profile.name, token: profile.token, team: profile.activeMonsters },
      });
      break;
    }

    case "queue": {
      const s = world.sessions.get(conn.playerId);
      if (!s || s.state !== "idle") return;
      s.state = "queued";
      world.queue.push(conn.playerId);
      if (world.formingAtTick === null) world.formingAtTick = world.tick + world.cfg.countdownTicks;
      send(conn.ws, { t: "queued", position: world.queue.length });
      break;
    }

    case "unqueue": {
      const s = world.sessions.get(conn.playerId);
      if (!s || s.state !== "queued") return;
      s.state = "idle";
      world.queue = world.queue.filter((id) => id !== conn.playerId);
      if (world.queue.length === 0) world.formingAtTick = null;
      send(conn.ws, { t: "unqueued" });
      break;
    }

    case "input": {
      const s = world.sessions.get(conn.playerId);
      if (!s || s.state !== "in_round") return;
      const rp = world.rounds.get(s.roundId)?.players.get(conn.playerId);
      if (!rp) return;
      if (typeof msg.seq === "number") rp.lastSeq = msg.seq;
      if (msg.type === "move" && msg.payload) {
        rp.pendingMove = { dx: clampAxis(msg.payload.dx), dy: clampAxis(msg.payload.dy) };
      }
      break;
    }

    case "combatAction": {
      const s = world.sessions.get(conn.playerId);
      if (!s || s.state !== "in_round") return;
      const session = world.combats.get(msg.combatId);
      if (!session || session.playerId !== conn.playerId || session.resolving) return;
      // Resolution may be async (AI). Guard against double-actions while it runs.
      session.resolving = true;
      resolveCombatAction(session, msg.action || {}, session.rng)
        .then((res) => {
          session.resolving = false;
          if (!world.combats.has(session.combatId)) return; // torn down meanwhile
          send(conn.ws, { t: "combatUpdate", combatId: session.combatId, ...res });
          if (res.outcome) endCombat(world, session, res, send);
        })
        .catch((e) => { session.resolving = false; console.error("[combat] resolve error:", e); });
      break;
    }

    case "ping":
      send(conn.ws, { t: "pong", t0: msg.t0, t1: Date.now() });
      break;
  }
}

export function removePlayer(world, playerId) {
  if (!playerId) return;
  const s = world.sessions.get(playerId);
  if (!s) return;
  if (s.state === "queued") world.queue = world.queue.filter((id) => id !== playerId);
  if (s.state === "in_round") {
    const round = world.rounds.get(s.roundId);
    const rp = round?.players.get(playerId);
    if (rp?.inCombat) world.combats.delete(rp.inCombat);
    round?.players.delete(playerId);
    if (round && round.players.size === 0) world.rounds.delete(round.roundId);
  }
  world.sessions.delete(playerId);
  if (world.queue.length === 0) world.formingAtTick = null;
}

export function tickWorld(world, dt, send) {
  world.tick++;
  matchmake(world, send);
  for (const round of world.rounds.values()) tickRound(world, round, dt, send);
}

// Form a round when the queue is full, or the countdown elapsed with ≥ minPlayers.
function matchmake(world, send) {
  const full = world.queue.length >= GAME.MAX_PLAYERS;
  const countdownDone =
    world.formingAtTick !== null &&
    world.tick >= world.formingAtTick &&
    world.queue.length >= world.cfg.minPlayers;
  if (!full && !countdownDone) return;

  const ids = world.queue.splice(0, GAME.MAX_PLAYERS);
  world.formingAtTick = world.queue.length > 0 ? world.tick + world.cfg.countdownTicks : null;

  const round = {
    roundId: "r" + world.nextRound++,
    seed: randomSeed(),
    phase: "loading", // becomes "active" once the map is generated
    startedAtMs: Date.now(),
    players: new Map(),
    map: null,
  };
  world.rounds.set(round.roundId, round);

  for (const id of ids) {
    const s = world.sessions.get(id);
    if (!s) continue;
    s.state = "in_round";
    s.roundId = round.roundId;
    round.players.set(id, { x: 0, y: 0, pendingMove: null, lastSeq: 0, spawned: false });
    send(s.ws, { t: "matchFound", roundId: round.roundId, players: round.players.size });
  }

  // Generate the round's map from its seed off the tick loop, then spawn players.
  generateRound(world, round, send);
}

// Async map generation + spawn assignment. The round stays "loading" (unticked)
// until the map is ready, then each player gets a real walkable spawn + roundStart.
async function generateRound(world, round, send) {
  let map = null;
  try {
    map = await generateMap(null, round.seed);
  } catch (e) {
    console.error(`[tamers-quest] map gen failed for ${round.roundId}:`, e);
  }
  if (!world.rounds.has(round.roundId)) return; // everyone left during generation

  round.map = map;
  const spawnRng = makeRng((round.seed ^ 0x9e3779b9) >>> 0); // distinct stream from map gen
  const E = GAME.EFFECTIVE_TILE;

  // Round monsters in world space + a deterministic visible/hidden split
  // (decision Q2: "some invisible, some not"). Hidden ones only reveal up close.
  round.monsters = (map?.monsters || []).map((m) => ({
    id: m.id, typeName: m.typeName, level: m.level,
    x: m.tileX * E, y: m.tileY * E,
    hidden: hashString(String(m.id)) % 100 < HIDDEN_MONSTER_PCT,
  }));

  const ids = [...round.players.keys()];

  for (const id of ids) {
    const rp = round.players.get(id);
    const s = world.sessions.get(id);
    if (!rp || !s) continue;
    const tile = map ? findSpawnPoint(map.voidMap, spawnRng) : { x: 200, y: 200 };
    rp.x = tile.x * E;
    rp.y = tile.y * E;
    rp.spawned = true;
    send(s.ws, {
      t: "roundStart",
      roundId: round.roundId,
      seed: round.seed, // clients regenerate the identical map from this
      mapSize: map ? map.mapSize : 400,
      spawn: { x: rp.x, y: rp.y }, // world px
      you: { id, nickname: s.profile.name },
      players: ids
        .filter((o) => o !== id)
        .map((o) => ({ id: o, name: world.sessions.get(o)?.profile.name })),
      durationS: GAME.ROUND_DURATION_S,
    });
  }
  round.mapSize = map ? map.mapSize : 400;
  round.portals = [];
  round.startedAtMs = Date.now(); // in-round clock starts after map generation
  round.phase = "active";
}

function tickRound(world, round, dt, send) {
  if (round.phase !== "active") return; // still generating the map
  const speed = GAME.BASE_SPEED;
  for (const rp of round.players.values()) {
    if (rp.inCombat || !rp.pendingMove) continue; // movement locked while fighting
    let { dx, dy } = rp.pendingMove;
    if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }
    rp.x += dx * speed * dt;
    rp.y += dy * speed * dt;
    rp.pendingMove = null;
  }

  // Encounter detection (instanced duel — others keep moving). Hidden monsters
  // ambush too, since they stay in round.monsters until engaged.
  const ER2 = ENCOUNTER_RADIUS * ENCOUNTER_RADIUS;
  for (const [id, rp] of round.players) {
    if (rp.inCombat) continue;
    const entry = (round.monsters || []).find((mo) => {
      const dx = mo.x - rp.x, dy = mo.y - rp.y;
      return dx * dx + dy * dy <= ER2;
    });
    if (entry) startCombat(world, round, id, entry, send);
  }

  // Extraction loop: timer, shrinking safe zone, portals, extract/zone/timeout.
  updateExtraction(world, round, dt, send);

  if (world.tick % 2 !== 0) return; // ~half tick-rate snapshots; AoI filtering in P2
  const all = [...round.players.entries()];
  const monsters = round.monsters || [];
  for (const [id, rp] of all) {
    const s = world.sessions.get(id);
    if (!s) continue;
    // AoI: visible monsters within AOI_RADIUS, hidden ones only within REVEAL_RADIUS.
    const nearbyMonsters = monsters
      .filter((mo) => {
        const dx = mo.x - rp.x, dy = mo.y - rp.y, d2 = dx * dx + dy * dy;
        const r = mo.hidden ? REVEAL_RADIUS : AOI_RADIUS;
        return d2 <= r * r;
      })
      .map((mo) => ({ id: mo.id, typeName: mo.typeName, level: mo.level, x: mo.x, y: mo.y }));
    send(s.ws, {
      t: "snapshot",
      tick: world.tick,
      roundId: round.roundId,
      you: { id, x: Math.round(rp.x), y: Math.round(rp.y), ack: rp.lastSeq },
      players: all
        .filter(([oid]) => oid !== id)
        .map(([oid, orp]) => ({
          id: oid,
          name: world.sessions.get(oid)?.profile.name,
          x: Math.round(orp.x),
          y: Math.round(orp.y),
        })),
      monsters: nearbyMonsters,
      time: Math.ceil(round.remaining ?? 0),
      circle: round.circle || null,
      portals: round.portals || [],
    });
  }
}

// Round timer, shrinking safe zone, portals, and extract/zone/timeout handling.
function updateExtraction(world, round, dt, send) {
  const cfg = world.cfg;
  const E = GAME.EFFECTIVE_TILE;
  const elapsed = (Date.now() - round.startedAtMs) / 1000;
  round.remaining = Math.max(0, cfg.roundDurationS - elapsed);

  const cx = (round.mapSize / 2) * E;
  const cy = (round.mapSize / 2) * E;
  const fullR = (round.mapSize / 2) * E;
  if (elapsed >= cfg.circleStartS) {
    const span = Math.max(1, cfg.roundDurationS - cfg.circleStartS);
    round.circleRadius = Math.max(0, (round.remaining / span) * fullR);
  } else {
    round.circleRadius = fullR;
  }
  round.circle = { x: Math.round(cx), y: Math.round(cy), r: Math.round(round.circleRadius) };

  // Portals appear once the circle starts closing.
  if (elapsed >= cfg.circleStartS && round.map) {
    const want = Math.floor((elapsed - cfg.circleStartS) / cfg.portalIntervalS) + 1;
    while (round.portals.length < want) {
      if (!spawnPortal(round, cx, cy)) break;
    }
  }

  for (const [id, rp] of [...round.players]) {
    const s = world.sessions.get(id);
    if (!s) continue;
    // Extraction: step onto a portal → survive with your gains.
    if (round.portals.some((p) => sqDist(p.x, p.y, rp.x, rp.y) <= EXTRACT_RADIUS * EXTRACT_RADIUS)) {
      endRunForPlayer(world, round, id, "extracted", send);
      continue;
    }
    // Timeout: failed to escape in time.
    if (round.remaining <= 0) { endRunForPlayer(world, round, id, "timeout", send); continue; }
    // Zone damage outside the circle (not while in an instanced fight).
    if (elapsed >= cfg.circleStartS && !rp.inCombat) {
      if (sqDist(cx, cy, rp.x, rp.y) > round.circleRadius * round.circleRadius) {
        if (applyStorm(s, STORM_DPS * dt)) endRunForPlayer(world, round, id, "zone", send);
      }
    }
  }
}

function spawnPortal(round, cx, cy) {
  const E = GAME.EFFECTIVE_TILE;
  const map = round.map;
  if (!map) return false;
  for (let i = 0; i < 200; i++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.random() * round.circleRadius * 0.85;
    const tx = Math.floor((cx + Math.cos(ang) * dist) / E);
    const ty = Math.floor((cy + Math.sin(ang) * dist) / E);
    if (tx >= 0 && tx < round.mapSize && ty >= 0 && ty < round.mapSize && map.voidMap[tx]?.[ty]) {
      round.portals.push({ x: tx * E, y: ty * E });
      return true;
    }
  }
  return false;
}

// Storm damage to the active monster; advance on faint. Returns true if the
// whole team is now down (run lost to the zone).
function applyStorm(s, dmg) {
  const team = s.profile.activeMonsters || [];
  const active = team.find((m) => m.currentHealth > 0);
  if (!active) return true;
  active.currentHealth = Math.max(0, active.currentHealth - dmg);
  return active.currentHealth <= 0 && !team.some((m) => m.currentHealth > 0);
}

function endRunForPlayer(world, round, id, reason, send) {
  const s = world.sessions.get(id);
  const rp = round.players.get(id);
  if (rp?.inCombat) world.combats.delete(rp.inCombat);
  round.players.delete(id);
  if (s) {
    s.state = "idle";
    s.roundId = null;
    if (reason === "extracted") {
      for (const m of s.profile.activeMonsters || []) healToFull(m); // survived
      saveProfile(s.profile);
      send(s.ws, { t: "extracted", reason, team: s.profile.activeMonsters });
    } else {
      // Q10: death loses the active run team (vault kept per Q9). Refill from the
      // vault, else roll fresh starters so a player is never left with nothing.
      const prof = s.profile;
      prof.vaultMonsters = prof.vaultMonsters || [];
      prof.activeMonsters = prof.vaultMonsters.splice(0, GAME.TEAM_SIZE);
      if (prof.activeMonsters.length === 0) prof.activeMonsters = rollStarters();
      saveProfile(prof);
      send(s.ws, { t: "died", reason, team: prof.activeMonsters });
    }
  }
  if (round.players.size === 0) world.rounds.delete(round.roundId);
}

function healToFull(inst) {
  const st = getMonsterStats(getMonsterType(inst.typeName), inst.level);
  inst.currentHealth = st.health;
  inst.currentEnergy = st.energy;
  inst.status = null;
}

function sqDist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

// Begin an instanced PvE fight between a player and a wild monster entry.
function startCombat(world, round, playerId, entry, send) {
  const s = world.sessions.get(playerId);
  if (!s) return;
  const team = s.profile.activeMonsters || [];
  const activeIdx = team.findIndex((m) => m.currentHealth > 0);
  if (activeIdx < 0) return; // no usable monster — ignore the encounter
  const rp = round.players.get(playerId);
  if (!rp || rp.inCombat) return;

  // Q8: partial energy restore per encounter so a depleted team can still fight.
  for (const m of team) if (m.currentHealth > 0) restoreEnergyPartial(m);

  round.monsters = round.monsters.filter((m) => m !== entry); // engaged → off the map
  const enemy = makeEnemy(entry);
  const combatId = "c" + world.nextCombat++;
  world.combats.set(combatId, {
    combatId, playerId, roundId: round.roundId,
    team, activeIdx, enemy, monsterEntry: entry, rng: makeRng(randomSeed()),
  });
  rp.inCombat = combatId;

  send(s.ws, {
    t: "combatStart",
    combatId,
    enemy: monSnap(enemy),
    active: monSnap(team[activeIdx]),
    attacks: attacksFor(team[activeIdx]),
  });
}

// Finish a combat: unlock movement, apply outcome (catch adds to roster, flee
// returns the monster to the map), persist, and notify the client.
function endCombat(world, session, res, send) {
  const s = world.sessions.get(session.playerId);
  if (!s) { world.combats.delete(session.combatId); return; }
  const round = world.rounds.get(session.roundId);
  const rp = round?.players.get(session.playerId);
  if (rp) rp.inCombat = null;

  if (res.outcome === "caught") {
    const e = session.enemy;
    const caught = {
      id: "m_caught_" + session.combatId,
      typeName: e.typeName, name: e.typeName, level: e.level, xp: 0,
      currentHealth: e.currentHealth, currentEnergy: e.currentEnergy, status: null,
    };
    const prof = s.profile;
    if ((prof.activeMonsters?.length || 0) < GAME.TEAM_SIZE) prof.activeMonsters.push(caught);
    else { prof.vaultMonsters = prof.vaultMonsters || []; prof.vaultMonsters.push(caught); }
  } else if (res.outcome === "fled" && round && session.monsterEntry) {
    round.monsters.push(session.monsterEntry); // monster returns to the map
  }
  // won: monster stays removed. lost: team fainted (run penalty handled in P4).

  saveProfile(s.profile);
  world.combats.delete(session.combatId);
  send(s.ws, {
    t: "combatEnd",
    combatId: session.combatId,
    outcome: res.outcome,
    team: s.profile.activeMonsters,
  });
}

function sanitizeNick(n) {
  const s = (typeof n === "string" ? n : "").trim().replace(/\s+/g, " ");
  return (s || "Tamer").slice(0, 20);
}

function clampAxis(v) {
  v = Number(v) || 0;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
