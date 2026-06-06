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
import { generateMonster } from "./content.js";
import { maybeStartPvp, handlePvpAction, endPvpFor } from "./pvp.js";

// Area-of-interest radii (world px) for snapshot filtering.
const AOI_RADIUS = 900; // visible monsters within this of a player
const REVEAL_RADIUS = 220; // hidden monsters only reveal within this (ambush)
const HIDDEN_MONSTER_PCT = 35; // ~this % of monsters start hidden (decision Q2)
const ENCOUNTER_RADIUS = 44; // walk within this of a monster to start a fight
const EXTRACT_RADIUS = 48; // step within this of a portal to extract
const STORM_DPS = 25; // active-monster HP lost per second outside the safe zone
const DISCONNECT_GRACE_MS = 120000; // Q12: keep a dropped in-round player this long to reconnect; else it's a death

export function createWorld({
  countdownTicks = 75,
  minPlayers = 1,
  roundDurationS = GAME.ROUND_DURATION_S,
  circleStartS = GAME.CIRCLE_START_S,
  portalIntervalS = GAME.PORTAL_INTERVAL_S,
  monsterGenRate = 0, // P5: chance per round to generate+add a new AI monster (0 = off)
  pvpEnabled = false, // P3-T5: FFA PvP on collision (0/off by default until the client UI ships)
} = {}) {
  return {
    cfg: { countdownTicks, minPlayers, roundDurationS, circleStartS, portalIntervalS, monsterGenRate, pvpEnabled },
    sessions: new Map(), // playerId -> { profile, ws, state:'idle'|'queued'|'in_round', roundId }
    queue: [], // playerIds awaiting a match, in arrival order
    formingAtTick: null, // tick the next round starts (countdown), or null when queue empty
    rounds: new Map(), // roundId -> { roundId, seed, phase, startedAtMs, players:Map(id->rp) }
    combats: new Map(), // combatId -> { combatId, playerId, roundId, team, activeIdx, enemy, ... }
    pvps: new Map(), // pvpId -> { pvpId, roundId, a, b, resolving } (P3-T5)
    tick: 0,
    nextRound: 1,
    nextCombat: 1,
    nextPvp: 1,
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
      const existing = world.sessions.get(profile.id);
      if (existing && !existing.disconnected) {
        send(conn.ws, { t: "error", code: "already_connected", message: "Profile already connected." });
        return;
      }
      conn.playerId = profile.id;
      const welcome = { t: "welcome", you: { id: profile.id, nickname: profile.name, token: profile.token, team: profile.activeMonsters } };

      if (existing && existing.disconnected) {
        // Q12 reconnect within the grace window: re-attach this socket and resume.
        existing.ws = conn.ws;
        existing.disconnected = false;
        existing.disconnectedAt = null;
        send(conn.ws, welcome);
        const round = existing.roundId ? world.rounds.get(existing.roundId) : null;
        const rp = round?.players.get(profile.id);
        if (round && rp) resumeRound(world, existing, round, rp, send);
        else { existing.state = "idle"; existing.roundId = null; } // round ended during the grace window
        return;
      }

      world.sessions.set(profile.id, { profile, ws: conn.ws, state: "idle", roundId: null });
      send(conn.ws, welcome);
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
      // PvP duel (P3-T5)? Route there. Else the PvE path below.
      const pvp = world.pvps.get(msg.combatId);
      if (pvp) { handlePvpAction(world, pvp, conn.playerId, msg.action || {}, send).catch((e) => console.error("[pvp] action:", e)); break; }
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

export function removePlayer(world, playerId, send = () => {}) {
  if (!playerId) return;
  const s = world.sessions.get(playerId);
  if (!s) return;
  if (s.state === "in_round") {
    // Q12: don't drop them immediately — keep their round slot for a grace window
    // so they can reconnect and resume. Any active fight is dropped (resume roaming).
    const round = world.rounds.get(s.roundId);
    const rp = round?.players.get(playerId);
    if (rp?.inCombat) { world.combats.delete(rp.inCombat); rp.inCombat = null; }
    if (rp?.inPvp) endPvpFor(world, playerId, send); // end any duel (no-contest)
    s.disconnected = true;
    s.disconnectedAt = Date.now();
    return; // session + round membership kept; sweepDisconnected handles expiry
  }
  if (s.state === "queued") world.queue = world.queue.filter((id) => id !== playerId);
  world.sessions.delete(playerId);
  if (world.queue.length === 0) world.formingAtTick = null;
}

export function tickWorld(world, dt, send) {
  world.tick++;
  sweepDisconnected(world, send);
  matchmake(world, send);
  for (const round of world.rounds.values()) tickRound(world, round, dt, send);
}

// Q12: a disconnected in-round player who doesn't reconnect within the grace
// window is treated as a death (loses the active team, per Q10), then dropped.
function sweepDisconnected(world, send) {
  for (const [id, s] of world.sessions) {
    if (!s.disconnected || Date.now() - s.disconnectedAt <= DISCONNECT_GRACE_MS) continue;
    const round = s.roundId ? world.rounds.get(s.roundId) : null;
    if (round && round.players.get(id)) endRunForPlayer(world, round, id, "disconnect", send);
    world.sessions.delete(id);
  }
}

// Resume a reconnected player into their in-progress round at their current
// position (reuses the client's roundStart path; the next snapshot syncs time/zone).
function resumeRound(world, s, round, rp, send) {
  const ids = [...round.players.keys()];
  send(s.ws, {
    t: "roundStart",
    roundId: round.roundId,
    seed: round.seed,
    mapSize: round.mapSize,
    spawn: { x: Math.round(rp.x), y: Math.round(rp.y) },
    you: { id: s.profile.id, nickname: s.profile.name },
    players: ids.filter((o) => o !== s.profile.id).map((o) => ({ id: o, name: world.sessions.get(o)?.profile.name })),
    durationS: GAME.ROUND_DURATION_S,
    resumed: true,
  });
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
  // Fire-and-forget, but never let a rejection escape (it would otherwise become
  // an unhandled rejection); generateRound also try/catches the gen itself.
  generateRound(world, round, send).catch((e) => console.error("[tamers-quest] generateRound:", e));
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

  // P5: occasionally grow the pool with a new AI monster (gated by config; costs
  // an OpenAI call). Fire-and-forget — it joins the pool for FUTURE rounds and
  // never blocks this round's start.
  if (world.cfg.monsterGenRate > 0 && Math.random() < world.cfg.monsterGenRate) {
    generateMonster().catch((e) => console.error("[content] generateMonster:", e.message));
  }
}

function tickRound(world, round, dt, send) {
  if (round.phase !== "active") return; // still generating the map
  const speed = GAME.BASE_SPEED;
  const maxXY = Math.max(0, (round.mapSize - 1) * GAME.EFFECTIVE_TILE); // play-area bound
  for (const rp of round.players.values()) {
    if (rp.inCombat || rp.inPvp || !rp.pendingMove) continue; // movement locked while fighting
    let { dx, dy } = rp.pendingMove;
    if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }
    // Server-authoritative position, clamped to the map (anti-cheat: no walking
    // infinitely off-map; speed/direction already clamped at input). Per-axis tile
    // collision so you slide along walls instead of passing through them.
    const nx = Math.min(maxXY, Math.max(0, rp.x + dx * speed * dt));
    const ny = Math.min(maxXY, Math.max(0, rp.y + dy * speed * dt));
    if (isWalkable(round.map, nx, rp.y)) rp.x = nx;
    if (isWalkable(round.map, rp.x, ny)) rp.y = ny;
    rp.pendingMove = null;
  }

  // Encounter detection (instanced duel — others keep moving). Hidden monsters
  // ambush too, since they stay in round.monsters until engaged.
  const ER2 = ENCOUNTER_RADIUS * ENCOUNTER_RADIUS;
  for (const [id, rp] of round.players) {
    if (rp.inCombat || rp.inPvp) continue;
    const entry = (round.monsters || []).find((mo) => {
      const dx = mo.x - rp.x, dy = mo.y - rp.y;
      return dx * dx + dy * dy <= ER2;
    });
    if (entry) startCombat(world, round, id, entry, send);
  }

  // FFA PvP on collision (P3-T5) — gated until the client UI ships.
  if (world.cfg.pvpEnabled) maybeStartPvp(world, round, send);

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
      you: { id, x: Math.round(rp.x), y: Math.round(rp.y), ack: rp.lastSeq, team: teamHp(s.profile) },
      // Q13: rivals are AoI-filtered like monsters — only those within view range
      // appear (a threat you discover, not always-on blips).
      players: all
        .filter(([oid, orp]) => oid !== id && sqDist(orp.x, orp.y, rp.x, rp.y) <= AOI_RADIUS * AOI_RADIUS)
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
    // Zone damage outside the circle (not while in an instanced fight or duel).
    if (elapsed >= cfg.circleStartS && !rp.inCombat && !rp.inPvp) {
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
  if (rp?.inPvp) endPvpFor(world, id, send); // end any duel (no-contest) before leaving
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

// Compact per-monster HP for the client HUD (reflects storm/combat damage live).
// Defensive on type lookup — this runs in the tick loop for every player.
function teamHp(profile) {
  return (profile.activeMonsters || []).map((m) => {
    const mt = getMonsterType(m.typeName);
    const max = mt ? getMonsterStats(mt, m.level).health : Math.round(m.currentHealth) || 1;
    return { hp: Math.max(0, Math.round(m.currentHealth)), max };
  });
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

// Tile collision: voidMap truthy = walkable floor (DLA-carved). World coord /
// EFFECTIVE_TILE = tile index. No map yet (still loading) → permissive.
function isWalkable(map, x, y) {
  if (!map?.voidMap) return true;
  const E = GAME.EFFECTIVE_TILE;
  return !!map.voidMap[Math.floor(x / E)]?.[Math.floor(y / E)];
}

function sanitizeNick(n) {
  const s = (typeof n === "string" ? n : "").trim().replace(/\s+/g, " ");
  return (s || "Tamer").slice(0, 20);
}

function clampAxis(v) {
  v = Number(v) || 0;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
