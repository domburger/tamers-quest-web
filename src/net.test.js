import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMessage, TOKEN_KEY } from "./net.js";

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

test("snapshot updates self + ack + players", () => {
  const s = freshState();
  applyMessage(s, { t: "snapshot", you: { id: "p1", x: 120, y: 240, ack: 7 }, players: [{ id: "p2", name: "Ben", x: 50, y: 60 }] });
  assert.deepEqual(s.self, { x: 120, y: 240 });
  assert.equal(s.ack, 7);
  assert.equal(s.players[0].x, 50);
});

test("applyMessage emits the message type", () => {
  const s = freshState();
  let got = null;
  applyMessage(s, { t: "queued" }, { emit: (ev) => { got = ev; } });
  assert.equal(got, "queued");
});
