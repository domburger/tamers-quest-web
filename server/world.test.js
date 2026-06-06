import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes } from "../src/engine/gamedata.js";
import { getMonsterStats } from "../src/engine/stats.js";
import { GAME } from "../src/engine/schemas.js";
import { createWorld, handleMessage, removePlayer, tickWorld } from "./world.js";

function loadData() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"), attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"), items: read("item.json"),
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastOf = (sent, t) => sent.filter((m) => m.t === t).pop();

function newCtx() {
  loadData();
  const sent = [];
  const send = (ws, obj) => sent.push(obj);
  const world = createWorld({ minPlayers: 1, countdownTicks: 1, circleStartS: 9999 });
  const conn = { ws: { readyState: 1 }, playerId: null };
  return { world, conn, sent, send };
}

// Form a round and wait until the async map generation makes it active.
async function activeRound(cfgOverride = {}) {
  loadData();
  const sent = [];
  const send = (ws, obj) => sent.push(obj);
  const world = createWorld({ minPlayers: 1, countdownTicks: 1, circleStartS: 9999, ...cfgOverride });
  const conn = { ws: { readyState: 1 }, playerId: null };
  handleMessage(world, conn, { t: "join", nickname: "Tester" }, send);
  handleMessage(world, conn, { t: "queue" }, send);
  tickWorld(world, 0.066, send); // forms the round → async map gen begins
  const deadline = Date.now() + 9000;
  while (![...world.rounds.values()].some((r) => r.phase === "active")) {
    if (Date.now() > deadline) throw new Error("round never became active");
    await sleep(20);
  }
  const round = [...world.rounds.values()].find((r) => r.phase === "active");
  return { world, conn, sent, send, round, id: conn.playerId };
}

// ── Fast tests (no map generation) ──

test("createWorld starts empty with the given config", () => {
  const { world } = newCtx();
  assert.equal(world.sessions.size, 0);
  assert.equal(world.queue.length, 0);
  assert.equal(world.rounds.size, 0);
  assert.equal(world.cfg.minPlayers, 1);
});

test("join issues a welcome with id, token, and a full starter team", () => {
  const { world, conn, sent, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: "Ash" }, send);
  const w = lastOf(sent, "welcome");
  assert.ok(w, "welcome sent");
  assert.ok(w.you.id && w.you.token);
  assert.equal(w.you.nickname, "Ash");
  assert.equal(w.you.team.length, Math.min(GAME.TEAM_SIZE, getMonsterTypes().length));
  assert.equal(world.sessions.size, 1);
});

test("a second join on the same connection is ignored", () => {
  const { world, conn, sent, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: "Ash" }, send);
  handleMessage(world, conn, { t: "join", nickname: "Hijack" }, send);
  assert.equal(sent.filter((m) => m.t === "welcome").length, 1);
  assert.equal(world.sessions.size, 1);
});

test("queue then unqueue toggles state and the queue", () => {
  const { world, conn, sent, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: "Ash" }, send);
  handleMessage(world, conn, { t: "queue" }, send);
  assert.equal(world.queue.length, 1);
  assert.ok(lastOf(sent, "queued"));
  handleMessage(world, conn, { t: "unqueue" }, send);
  assert.equal(world.queue.length, 0);
  assert.ok(lastOf(sent, "unqueued"));
});

test("matchmaker does not form a round before the countdown elapses", () => {
  loadData();
  const sent = [];
  const send = (ws, obj) => sent.push(obj);
  const world = createWorld({ minPlayers: 1, countdownTicks: 100 });
  const conn = { ws: { readyState: 1 }, playerId: null };
  handleMessage(world, conn, { t: "join", nickname: "Ash" }, send);
  handleMessage(world, conn, { t: "queue" }, send);
  tickWorld(world, 0.066, send); // tick 1, well before the 100-tick countdown
  assert.equal(world.rounds.size, 0);
});

test("removePlayer clears the session and the queue", () => {
  const { world, conn, sent, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: "Ash" }, send);
  handleMessage(world, conn, { t: "queue" }, send);
  removePlayer(world, conn.playerId);
  assert.equal(world.sessions.size, 0);
  assert.equal(world.queue.length, 0);
  assert.equal(world.formingAtTick, null);
});

test("handleMessage ignores junk and unauthenticated actions without throwing", () => {
  const { world, conn, send } = newCtx();
  assert.doesNotThrow(() => {
    handleMessage(world, conn, null, send);
    handleMessage(world, conn, { t: 123 }, send);
    handleMessage(world, conn, { t: "totally-unknown" }, send);
    handleMessage(world, conn, { t: "queue" }, send); // no session yet
    handleMessage(world, conn, { t: "input", type: "move", payload: { dx: 1, dy: 0 } }, send);
    handleMessage(world, conn, { t: "combatAction", combatId: "nope", action: { kind: "attack" } }, send);
  });
  assert.equal(world.sessions.size, 0);
});

// ── Round-lifecycle tests (one map generation each) ──

test("round goes active: roundStart spawn + snapshot carry the world state", async () => {
  const { world, sent, send, round, id } = await activeRound();
  const rs = lastOf(sent, "roundStart");
  assert.ok(rs, "roundStart sent");
  const E = GAME.EFFECTIVE_TILE;
  assert.ok(round.map.voidMap[Math.floor(rs.spawn.x / E)][Math.floor(rs.spawn.y / E)], "spawn is walkable");

  tickWorld(world, 0.066, send); // even tick → snapshot
  tickWorld(world, 0.066, send);
  const snap = lastOf(sent, "snapshot");
  assert.ok(snap, "snapshot sent");
  assert.equal(snap.you.id, id);
  assert.ok(Array.isArray(snap.you.team) && snap.you.team.length > 0, "snapshot has team HP");
  assert.ok(snap.circle, "snapshot has the safe zone");
});

test("tile collision: a player pushed into walls never occupies a wall tile", async () => {
  const { world, conn, send, round } = await activeRound();
  const rp = round.players.get(conn.playerId);
  const E = GAME.EFFECTIVE_TILE;
  const walk = (x, y) => !!round.map.voidMap[Math.floor(x / E)]?.[Math.floor(y / E)];
  let violations = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let i = 0; i < 70; i++) {
      handleMessage(world, conn, { t: "input", type: "move", payload: { dx, dy } }, send);
      tickWorld(world, 0.066, send);
      if (!walk(rp.x, rp.y)) violations++;
    }
  }
  assert.equal(violations, 0);
});

test("extraction: stepping on a portal extracts you and heals the team", async () => {
  const { world, conn, send, round, sent } = await activeRound({ circleStartS: 0, portalIntervalS: 1 });
  tickWorld(world, 0.066, send); // spawn a portal (circle is closing)
  assert.ok(round.portals.length > 0, "a portal exists");
  const s = world.sessions.get(conn.playerId);
  s.profile.activeMonsters[0].currentHealth = 1; // wound the lead monster
  const rp = round.players.get(conn.playerId);
  const p = round.portals[0];
  rp.x = p.x; rp.y = p.y; // stand on the portal
  tickWorld(world, 0.066, send);
  const ex = lastOf(sent, "extracted");
  assert.ok(ex, "extracted event sent");
  const lead = ex.team[0];
  const max = getMonsterStats(getMonsterTypes().find((m) => m.typeName === lead.typeName), lead.level).health;
  assert.equal(lead.currentHealth, max, "lead monster healed to full on extract");
  assert.equal(world.sessions.get(conn.playerId).state, "idle");
});

test("Q13: players are AoI-filtered — only nearby rivals appear in snapshots", async () => {
  loadData();
  const sent = [];
  const send = (ws, obj) => sent.push(obj);
  const world = createWorld({ minPlayers: 2, countdownTicks: 1, circleStartS: 9999 });
  const a = { ws: { readyState: 1 }, playerId: null };
  const b = { ws: { readyState: 1 }, playerId: null };
  for (const c of [a, b]) {
    handleMessage(world, c, { t: "join", nickname: "p" }, send);
    handleMessage(world, c, { t: "queue" }, send);
  }
  tickWorld(world, 0.066, send);
  const deadline = Date.now() + 9000;
  while (![...world.rounds.values()].some((r) => r.phase === "active")) {
    if (Date.now() > deadline) throw new Error("round never became active");
    await sleep(20);
  }
  const round = [...world.rounds.values()].find((r) => r.phase === "active");
  const rpA = round.players.get(a.playerId), rpB = round.players.get(b.playerId);
  const snapFor = (id) => sent.filter((m) => m.t === "snapshot" && m.you?.id === id).pop();

  // Far apart (≫ AoI) → neither sees the other.
  rpA.x = 0; rpA.y = 0; rpB.x = 50000; rpB.y = 50000;
  sent.length = 0;
  tickWorld(world, 0.066, send); tickWorld(world, 0.066, send);
  assert.equal(snapFor(a.playerId)?.players.length, 0, "far rival is hidden");

  // Close (< AoI) → they see each other.
  rpB.x = rpA.x + 100; rpB.y = rpA.y;
  sent.length = 0;
  tickWorld(world, 0.066, send); tickWorld(world, 0.066, send);
  const near = snapFor(a.playerId);
  assert.equal(near.players.length, 1, "nearby rival is visible");
  assert.equal(near.players[0].id, b.playerId);
});

test("timeout death applies the Q10 penalty: lose active team, refill from vault", async () => {
  const { world, conn, send, round, sent } = await activeRound();
  const s = world.sessions.get(conn.playerId);
  const marker = { id: "vault_marker", typeName: s.profile.activeMonsters[0].typeName, level: 7, currentHealth: 30, currentEnergy: 5 };
  s.profile.vaultMonsters = [marker];
  round.startedAtMs = Date.now() - (world.cfg.roundDurationS + 5) * 1000; // force timeout
  tickWorld(world, 0.066, send);
  const died = lastOf(sent, "died");
  assert.ok(died, "died event sent");
  assert.equal(died.reason, "timeout");
  assert.equal(died.team.length, 1);
  assert.equal(died.team[0].id, "vault_marker", "active team replaced by the vault");
  assert.equal(s.profile.vaultMonsters.length, 0, "vault was consumed");
});
