// Authoritative world state + message handling + tick. Pure-ish Node module
// (no WebSocket specifics — index.js wires transport). Imports the shared engine
// to prove client/server logic reuse. Scaffold for P1: a single shared FFA round;
// matchmaking/multi-round (P1-T4), seeded-map spawns (P2), and combat (P3) follow.

import { randomSeed } from "../src/engine/rng.js";
import { GAME } from "../src/engine/schemas.js";
import { getByToken, createProfile } from "./store.js";

export function createWorld() {
  return {
    // One shared free-for-all round for now (no allied teams — decision Q2).
    round: { roundId: "r1", seed: randomSeed(), phase: "active", startedAtMs: Date.now() },
    players: new Map(), // playerId -> player record
    tick: 0,
  };
}

export function handleMessage(world, conn, msg, send) {
  if (!msg || typeof msg.t !== "string") return;
  switch (msg.t) {
    case "hello":
      send(conn.ws, { t: "welcome", serverTime: Date.now(), maxPlayers: GAME.MAX_PLAYERS });
      break;

    case "join": {
      if (conn.playerId) return; // already joined on this connection
      if (world.players.size >= GAME.MAX_PLAYERS) {
        send(conn.ws, { t: "error", code: "round_full", message: "Round is full." });
        return;
      }
      // Resume an existing profile by session token, or create a new anonymous
      // one from a nickname (decision Q6). createProfile rolls a base inventory.
      let profile = getByToken(msg.token);
      if (!profile) profile = createProfile(sanitizeNick(msg.nickname));
      if (world.players.has(profile.id)) {
        send(conn.ws, { t: "error", code: "already_in_round", message: "Already in a round." });
        return;
      }
      conn.playerId = profile.id;
      const spawn = { x: 0, y: 0 }; // server-assigned; real spawn from seeded map in P2
      world.players.set(profile.id, {
        playerId: profile.id, profile, ws: conn.ws,
        x: spawn.x, y: spawn.y, pendingMove: null, lastSeq: 0,
      });
      send(conn.ws, {
        t: "roundStart",
        roundId: world.round.roundId,
        seed: world.round.seed, // client regenerates the identical map from this
        mapSize: 400,
        spawn,
        you: {
          id: profile.id,
          nickname: profile.name,
          token: profile.token, // client stores this to resume the profile later
          team: profile.activeMonsters,
        },
        durationS: GAME.ROUND_DURATION_S,
      });
      break;
    }

    case "input": {
      const p = world.players.get(conn.playerId);
      if (!p) return;
      if (typeof msg.seq === "number") p.lastSeq = msg.seq;
      if (msg.type === "move" && msg.payload) {
        p.pendingMove = { dx: clampAxis(msg.payload.dx), dy: clampAxis(msg.payload.dy) };
      }
      break;
    }

    case "ping":
      send(conn.ws, { t: "pong", t0: msg.t0, t1: Date.now() });
      break;
  }
}

export function removePlayer(world, playerId) {
  if (playerId) world.players.delete(playerId);
}

// Advance the world one tick. `send(ws, obj)` is the transport sender.
export function tickWorld(world, dt, send) {
  world.tick++;

  // Apply movement intents authoritatively (collision + zone come in P2/P4).
  const speed = 200; // px/s, matches client BASE_SPEED
  for (const p of world.players.values()) {
    if (!p.pendingMove) continue;
    let { dx, dy } = p.pendingMove;
    if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; } // normalize diagonal
    p.x += dx * speed * dt;
    p.y += dy * speed * dt;
    p.pendingMove = null;
  }

  // Broadcast snapshots at ~half the tick rate. AoI filtering + hidden monsters
  // are P2; for now every player sees every other player.
  if (world.tick % 2 === 0) {
    const all = [...world.players.values()];
    for (const p of all) {
      send(p.ws, {
        t: "snapshot",
        tick: world.tick,
        you: { id: p.playerId, x: Math.round(p.x), y: Math.round(p.y), ack: p.lastSeq },
        players: all
          .filter((o) => o.playerId !== p.playerId)
          .map((o) => ({ id: o.playerId, name: o.profile.name, x: Math.round(o.x), y: Math.round(o.y) })),
      });
    }
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
