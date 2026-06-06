// Authoritative world: sessions + lobby/matchmaking + concurrent rounds + tick.
// Imports the shared engine so client and server run identical rules.
// Flow: join (session) → queue → matchmaker forms a round (≤16, fresh seed) →
// roundStart → in-round movement/snapshots. Combat (P3), seeded-map spawns (P2),
// and DB persistence (P1-T2) plug in later behind the existing seams.

import { randomSeed, makeRng } from "../src/engine/rng.js";
import { GAME } from "../src/engine/schemas.js";
import { generateMap, findSpawnPoint } from "../src/engine/mapgen.js";
import { getByToken, createProfile } from "./store.js";

export function createWorld({ countdownTicks = 75, minPlayers = 1 } = {}) {
  return {
    cfg: { countdownTicks, minPlayers },
    sessions: new Map(), // playerId -> { profile, ws, state:'idle'|'queued'|'in_round', roundId }
    queue: [], // playerIds awaiting a match, in arrival order
    formingAtTick: null, // tick the next round starts (countdown), or null when queue empty
    rounds: new Map(), // roundId -> { roundId, seed, phase, startedAtMs, players:Map(id->rp) }
    tick: 0,
    nextRound: 1,
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
  round.phase = "active";
}

function tickRound(world, round, dt, send) {
  if (round.phase !== "active") return; // still generating the map
  const speed = GAME.BASE_SPEED;
  for (const rp of round.players.values()) {
    if (!rp.pendingMove) continue;
    let { dx, dy } = rp.pendingMove;
    if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }
    rp.x += dx * speed * dt;
    rp.y += dy * speed * dt;
    rp.pendingMove = null;
  }

  if (world.tick % 2 !== 0) return; // ~half tick-rate snapshots; AoI filtering in P2
  const all = [...round.players.entries()];
  for (const [id, rp] of all) {
    const s = world.sessions.get(id);
    if (!s) continue;
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
    });
  }
}

function sanitizeNick(n) {
  const s = (typeof n === "string" ? n : "").trim().replace(/\s+/g, " ");
  return (s || "Tamer").slice(0, 20);
}

function clampAxis(v) {
  v = Number(v) || 0;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
