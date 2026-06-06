import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMessage, TOKEN_KEY, createNetClient } from "./net.js";

function freshState() {
  return {
    phase: "idle", playerId: null, nickname: null, token: null, team: [],
    roundId: null, seed: null, mapSize: 0, self: { x: 0, y: 0 }, players: [], ack: 0,
  };
}
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}

test("welcome stores token + team + identity", () => {
  const s = freshState(), st = memStorage();
  applyMessage(s, { t: "welcome", you: { id: "pl1", nickname: "Ash", token: "tk1", team: [{ typeName: "X" }] } }, { storage: st });
  assert.equal(s.playerId, "pl1");
  assert.equal(s.nickname, "Ash");
  assert.equal(s.token, "tk1");
  assert.equal(s.team.length, 1);
  assert.equal(st.getItem(TOKEN_KEY), "tk1");
});

test("queued then matchFound update phase + round", () => {
  const s = freshState();
  applyMessage(s, { t: "queued", position: 1 });
  assert.equal(s.phase, "queued");
  applyMessage(s, { t: "matchFound", roundId: "r1" });
  assert.equal(s.phase, "matched");
  assert.equal(s.roundId, "r1");
});

test("roundStart sets seed/spawn/players and goes in_round", () => {
  const s = freshState();
  applyMessage(s, { t: "roundStart", roundId: "r1", seed: 12345, mapSize: 400, spawn: { x: 800, y: 1600 }, players: [{ id: "p2", name: "Ben" }] });
  assert.equal(s.phase, "in_round");
  assert.equal(s.seed, 12345);
  assert.equal(s.mapSize, 400);
  assert.deepEqual(s.self, { x: 800, y: 1600 });
  assert.equal(s.players.length, 1);
});

test("snapshot updates self + ack + players + monsters", () => {
  const s = freshState();
  applyMessage(s, {
    t: "snapshot",
    you: { id: "p1", x: 120, y: 240, ack: 7 },
    players: [{ id: "p2", name: "Ben", x: 50, y: 60 }],
    monsters: [{ id: "m_1_2", typeName: "Aqua Serpent", level: 3, x: 800, y: 900 }],
  });
  assert.deepEqual(s.self, { x: 120, y: 240 });
  assert.equal(s.ack, 7);
  assert.equal(s.players[0].x, 50);
  assert.equal(s.monsters.length, 1);
  assert.equal(s.monsters[0].typeName, "Aqua Serpent");
});

test("snapshot stores team HP and keeps last-known across frames", () => {
  const s = freshState();
  applyMessage(s, { t: "snapshot", you: { id: "p1", x: 1, y: 2, ack: 1, team: [{ hp: 30, max: 50 }] } });
  assert.deepEqual(s.self.team, [{ hp: 30, max: 50 }]);
  // A snapshot without team keeps the last-known team (and adds no undefined key).
  applyMessage(s, { t: "snapshot", you: { id: "p1", x: 3, y: 4, ack: 2 } });
  assert.deepEqual(s.self, { x: 3, y: 4, team: [{ hp: 30, max: 50 }] });
});

// The onlineGame disconnect overlay relies on state.connected flipping on close.
test("net client tracks connected across open/close", () => {
  class FakeWS {
    constructor() { this.readyState = 0; FakeWS.last = this; }
    send() {}
    close() { this.readyState = 3; this.onclose && this.onclose(); }
  }
  const net = createNetClient({ url: "ws://x", WebSocketImpl: FakeWS, storage: memStorage() });
  assert.equal(net.state.connected, false);
  net.connect();
  FakeWS.last.readyState = 1;
  FakeWS.last.onopen();
  assert.equal(net.state.connected, true);
  let closed = false;
  net.on("close", () => { closed = true; });
  FakeWS.last.onclose();
  assert.equal(net.state.connected, false);
  assert.equal(closed, true);
});

test("applyMessage emits the message type", () => {
  const s = freshState();
  let got = null;
  applyMessage(s, { t: "queued" }, { emit: (ev) => { got = ev; } });
  assert.equal(got, "queued");
});
