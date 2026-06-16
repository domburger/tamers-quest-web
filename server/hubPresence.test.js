// TQ-258: lobby presence — the server broadcasts a roster of co-present idle (in-hub) players to
// each other via hubSnapshot, driven by their hubMove reports. These tests pin the fan-out rules:
// self-exclusion, idle-only gating, and the freshness/staleness window.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, handleMessage, tickWorld } from "./world.js";

function join(world, nick, send) {
  const conn = { ws: { readyState: 1, _id: nick }, playerId: null };
  handleMessage(world, conn, { t: "join", nickname: nick }, send);
  return conn;
}
// tickWorld increments world.tick each call; broadcastHub fires on tick % 3 === 0, so 3 ticks guarantees one.
function tick3(world, send) { for (let i = 0; i < 3; i++) tickWorld(world, 0.066, send); }

test("TQ-258: each idle player gets a hubSnapshot of the OTHER co-present players (not self)", () => {
  const sent = [];
  const send = (ws, obj) => sent.push({ ws, obj });
  const world = createWorld({ minPlayers: 1, countdownTicks: 1 });
  const a = join(world, "A", send);
  const b = join(world, "B", send);
  handleMessage(world, a, { t: "hubMove", x: 100, y: 50 }, send);
  handleMessage(world, b, { t: "hubMove", x: 200, y: 60 }, send);
  sent.length = 0;
  tick3(world, send);
  const snaps = sent.filter((m) => m.obj.t === "hubSnapshot");
  const toA = snaps.find((m) => m.ws === a.ws);
  const toB = snaps.find((m) => m.ws === b.ws);
  assert.ok(toA && toB, "both idle players receive a hubSnapshot");
  assert.equal(toA.obj.players.length, 1, "A sees exactly one other");
  assert.equal(toA.obj.players[0].id, b.playerId, "A sees B, not itself");
  assert.equal(toA.obj.players[0].x, 200, "B's reported position is carried");
  assert.equal(toB.obj.players[0].id, a.playerId, "B sees A");
});

test("TQ-258: hubMove is ignored for a non-idle (queued) player; they vanish from the lobby roster", () => {
  const sent = [];
  const send = (ws, obj) => sent.push({ ws, obj });
  const world = createWorld({ minPlayers: 99, countdownTicks: 999 }); // never forms a round → A stays queued
  const a = join(world, "A", send);
  const b = join(world, "B", send);
  handleMessage(world, a, { t: "hubMove", x: 10, y: 10 }, send); // A in hub
  handleMessage(world, b, { t: "hubMove", x: 20, y: 20 }, send);
  handleMessage(world, a, { t: "queue" }, send);                 // A leaves idle
  handleMessage(world, a, { t: "hubMove", x: 11, y: 11 }, send); // ignored — not idle
  sent.length = 0;
  tick3(world, send);
  const snaps = sent.filter((m) => m.obj.t === "hubSnapshot");
  assert.equal(snaps.find((m) => m.ws === a.ws), undefined, "queued A receives no hub broadcast");
  const toB = snaps.find((m) => m.ws === b.ws);
  if (toB) assert.equal(toB.obj.players.length, 0, "B, alone in the hub, sees nobody");
});

test("TQ-258: a player with no fresh hubMove (stale) is not broadcast", () => {
  const sent = [];
  const send = (ws, obj) => sent.push({ ws, obj });
  const world = createWorld({ minPlayers: 1, countdownTicks: 1 });
  const a = join(world, "A", send);
  const b = join(world, "B", send);
  handleMessage(world, a, { t: "hubMove", x: 5, y: 5 }, send);
  // B never reports a position (e.g. sitting on the title screen) → not in the hub.
  // Force A's report stale by backdating it past the staleness window.
  world.sessions.get(a.playerId).hub.at -= 10000;
  sent.length = 0;
  tick3(world, send);
  const snaps = sent.filter((m) => m.obj.t === "hubSnapshot");
  assert.equal(snaps.length, 0, "no fresh in-hub players → no broadcast");
});
