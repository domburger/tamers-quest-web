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

test("applyMessage ignores a malformed/non-object message without throwing (protocol-skew resilience)", () => {
  const s = freshState();
  const snap = JSON.stringify(s);
  for (const bad of [null, undefined, 0, 42, "x", [], {}, { t: 99 }, { t: null }, { nope: 1 }]) {
    assert.doesNotThrow(() => applyMessage(s, bad, { storage: memStorage() }));
  }
  assert.equal(JSON.stringify(s), snap, "no mutation on garbage input");
});

test("welcome stores token + team + identity", () => {
  const s = freshState(), st = memStorage();
  applyMessage(s, { t: "welcome", you: { id: "pl1", nickname: "Ash", token: "tk1", team: [{ typeName: "X" }], stats: { runs: 3 } } }, { storage: st });
  assert.equal(s.playerId, "pl1");
  assert.equal(s.nickname, "Ash");
  assert.equal(s.token, "tk1");
  assert.equal(s.team.length, 1);
  assert.equal(s.stats.runs, 3);
  assert.equal(st.getItem(TOKEN_KEY), "tk1");
});

test("welcome + snapshot sync the spirit-chain inventory", () => {
  const s = freshState();
  applyMessage(s, { t: "welcome", you: { id: "p", nickname: "N", token: "t", team: [], chains: [{ chainId: "tier1", throwCount: 3, durability: 1 }], equippedChainId: "tier1" } }, { storage: memStorage() });
  assert.equal(s.equippedChainId, "tier1");
  assert.equal(s.chains[0].throwCount, 3);
  // A snapshot carrying updated counters refreshes the inventory; projectiles sync.
  applyMessage(s, { t: "snapshot", you: { id: "p", x: 0, y: 0, ack: 1, chains: [{ chainId: "tier1", throwCount: 2, durability: 1 }], equippedChainId: "tier1" }, projectiles: [{ id: "pr1", x: 5, y: 6, vx: 1, vy: 0, chainId: "tier1" }], chests: [{ id: "ch1", x: 9, y: 9 }] });
  assert.equal(s.chains[0].throwCount, 2);
  assert.equal(s.projectiles.length, 1);
  assert.equal(s.chests.length, 1);
});

test("welcome carries gold; shop message syncs gold + chains", () => {
  const s = freshState();
  applyMessage(s, { t: "welcome", you: { id: "p", nickname: "N", token: "t", team: [], gold: 120 } }, { storage: memStorage() });
  assert.equal(s.gold, 120);
  applyMessage(s, { t: "shop", ok: true, gold: 0, chains: [{ chainId: "tier3", throwCount: 8, durability: 3 }], equippedChainId: "tier1" });
  assert.equal(s.gold, 0);
  assert.equal(s.chains[0].chainId, "tier3");
});

test("killfeed accumulates (capped at 6) and clears on roundStart (P8-T5)", () => {
  const s = freshState();
  for (let i = 0; i < 8; i++) applyMessage(s, { t: "killfeed", victim: "V" + i, cause: "pvp", killer: "K" });
  assert.equal(s.killfeed.length, 6);
  assert.equal(s.killfeed[s.killfeed.length - 1].victim, "V7", "newest kept");
  applyMessage(s, { t: "roundStart", roundId: "r", seed: 1, mapSize: 10, spawn: { x: 0, y: 0 } });
  assert.deepEqual(s.killfeed, [], "cleared each round");
});

test("welcome + roster sync the vault (P8-T2)", () => {
  const s = freshState();
  applyMessage(s, { t: "welcome", you: { id: "p", nickname: "N", token: "t", team: [{ id: "a" }], vault: [{ id: "b" }] } }, { storage: memStorage() });
  assert.deepEqual(s.vault.map((m) => m.id), ["b"]);
  applyMessage(s, { t: "roster", team: [{ id: "a" }, { id: "b" }], vault: [{ id: "c" }] });
  assert.deepEqual(s.team.map((m) => m.id), ["a", "b"]);
  assert.deepEqual(s.vault.map((m) => m.id), ["c"]);
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

test("roundStart clears stale combat (mid-fight reconnect resumes roaming, not a dead overlay)", () => {
  const s = freshState();
  s.combat = { combatId: "c1", enemy: {}, log: [], outcome: null }; // mid-fight when the socket dropped
  applyMessage(s, { t: "roundStart", roundId: "r1", seed: 1, mapSize: 10, spawn: { x: 0, y: 0 } });
  assert.equal(s.combat, null); // server tore the combat down on disconnect; client must not stay stuck
});

test("roundStart clears stale spatial view state (no previous-round monsters/chests/circle flash at spawn)", () => {
  const s = freshState();
  // Leftovers from the prior round still in state when the new round starts.
  s.monsters = [{ id: "m_old" }];
  s.chests = [{ id: "ch_old" }];
  s.projectiles = [{ id: "pr_old" }];
  s.circle = { x: 1, y: 2, r: 99 };
  applyMessage(s, { t: "roundStart", roundId: "r1", seed: 1, mapSize: 10, spawn: { x: 0, y: 0 } });
  assert.deepEqual(s.monsters, []);
  assert.deepEqual(s.chests, []);
  assert.deepEqual(s.projectiles, []);
  assert.equal(s.circle, null);
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

test("net client auto-reconnects and re-joins after an unexpected drop", async () => {
  class FakeWS {
    constructor() { this.readyState = 0; FakeWS.last = this; FakeWS.count = (FakeWS.count || 0) + 1; }
    send(o) { (FakeWS.sent ||= []).push(o); }
    close() { this.readyState = 3; this.onclose && this.onclose(); }
  }
  FakeWS.count = 0; FakeWS.sent = [];
  const net = createNetClient({ url: "ws://x", WebSocketImpl: FakeWS, storage: memStorage(), reconnectIntervalMs: 5, reconnectWindowMs: 1000 });
  net.connect();
  FakeWS.last.readyState = 1; FakeWS.last.onopen();
  net.join("Ash"); // marks hasJoined
  applyMessage(net.state, { t: "welcome", you: { id: "p1", nickname: "Ash", token: "tk1", team: [] } }, { storage: memStorage() });
  assert.equal(net.state.token, "tk1");

  FakeWS.last.readyState = 3; FakeWS.last.onclose(); // unexpected drop (CLOSED)
  assert.equal(net.state.connected, false);
  assert.equal(net.state.reconnecting, true);
  const before = FakeWS.count;

  await new Promise((r) => setTimeout(r, 20)); // let the retry interval open a fresh socket
  assert.ok(FakeWS.count > before, "a new socket was created");
  FakeWS.last.readyState = 1; FakeWS.last.onopen(); // reconnect succeeds
  assert.equal(net.state.connected, true);
  assert.equal(net.state.reconnecting, false);
  assert.ok(
    FakeWS.sent.some((o) => { try { const m = JSON.parse(o); return m.t === "join" && m.token === "tk1"; } catch { return false; } }),
    "auto re-join with the token was sent"
  );
  net.close(); // cleanup timers
});

test("pong computes a non-negative smoothed rtt", () => {
  const s = freshState();
  applyMessage(s, { t: "pong", t0: Date.now() - 40 });
  assert.equal(typeof s.rtt, "number");
  assert.ok(s.rtt >= 0 && s.rtt < 60000);
  const first = s.rtt;
  applyMessage(s, { t: "pong", t0: Date.now() - 40 }); // stays a sane number when smoothing
  assert.ok(s.rtt >= 0 && s.rtt < 60000 && Number.isFinite(first));
});

test("combatStart/combatUpdate carry PvP flags (pvp, opponent, waiting)", () => {
  const s = freshState();
  applyMessage(s, { t: "combatStart", combatId: "v1", pvp: true, opponent: "Rival", enemy: { typeName: "X" }, active: { name: "Y" }, attacks: [] });
  assert.equal(s.combat.pvp, true);
  assert.equal(s.combat.opponent, "Rival");
  assert.equal(s.combat.waiting, false);
  applyMessage(s, { t: "combatUpdate", waiting: true, narrative: "wait" });
  assert.equal(s.combat.waiting, true);
  applyMessage(s, { t: "combatUpdate", narrative: "turn resolved" });
  assert.equal(s.combat.waiting, false, "cleared when the turn resolves");
});

test("applyMessage emits the message type", () => {
  const s = freshState();
  let got = null;
  applyMessage(s, { t: "queued" }, { emit: (ev) => { got = ev; } });
  assert.equal(got, "queued");
});

test("resumed roundStart restores live round state; fresh clears it (NC-10)", () => {
  const base = { t: "roundStart", roundId: "r", seed: 1, mapSize: 400, spawn: { x: 1, y: 2 } };
  // Resumed: zone/timer/portals/chests come from the payload (no first-snapshot flash).
  const s = freshState();
  applyMessage(s, { ...base, resumed: true, time: 123, circle: { x: 5, y: 6, r: 50 }, portals: [{ x: 9, y: 9 }], chests: [{ id: "c1", x: 1, y: 1 }] }, { storage: memStorage() });
  assert.equal(s.time, 123);
  assert.deepEqual(s.circle, { x: 5, y: 6, r: 50 });
  assert.equal(s.portals.length, 1);
  assert.equal(s.chests.length, 1);
  // Fresh round: spatial state cleared (the first snapshot fills it).
  const s2 = freshState();
  applyMessage(s2, base, { storage: memStorage() });
  assert.equal(s2.circle, null);
  assert.equal(s2.portals.length, 0);
  assert.equal(s2.chests.length, 0);
});

test("setSkin sends the cosmetic id; snapshot carries rivals' skinId (CN-12)", () => {
  class FakeWS {
    constructor() { this.readyState = 0; FakeWS.last = this; }
    send(o) { (FakeWS.sent ||= []).push(o); }
    close() { this.readyState = 3; }
  }
  FakeWS.sent = [];
  const net = createNetClient({ url: "ws://x", WebSocketImpl: FakeWS, storage: memStorage() });
  net.connect();
  FakeWS.last.readyState = 1; FakeWS.last.onopen();
  net.setSkin("void");
  assert.ok(
    FakeWS.sent.some((o) => { try { const m = JSON.parse(o); return m.t === "setSkin" && m.skinId === "void"; } catch { return false; } }),
    "setSkin message sent with the id"
  );
  // Rivals' skinId rides the snapshot through to state.players (for per-player rendering).
  applyMessage(net.state, { t: "snapshot", players: [{ id: "r1", name: "Riv", x: 1, y: 2, skinId: "ember" }] }, { storage: memStorage() });
  assert.equal(net.state.players[0].skinId, "ember");
  net.close();
});
