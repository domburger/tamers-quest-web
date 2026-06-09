import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterType, getAttacksForMonster } from "../src/engine/gamedata.js";
import { createWorld, handleMessage, tickWorld } from "./world.js";
import { endPvp, handlePvpAction } from "./pvp.js";
import { setAiConfig } from "./aiconfig.js"; // the duel test mocks the v1 absolute judge; pin it (v2 is now default)
import { GAME } from "../src/engine/schemas.js";
import { makeRng, hashString } from "../src/engine/rng.js";

function loadData() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"), attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"), items: read("item.json"),
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// NC-5: repeated PvP wins must not grow the winner's vault unbounded.
test("NC-5: PvP loot is capped at the winner's vault capacity", () => {
  const mk = (n) => ({ id: `m${n}`, typeName: "X", name: `m${n}`, level: 1, currentHealth: 1, currentEnergy: 1 });
  const winP = { name: "Win", stats: {}, activeMonsters: [mk(900)],
    vaultMonsters: Array.from({ length: GAME.VAULT_SIZE }, (_, i) => mk(i)) }; // already at cap
  const loseP = { name: "Lose", stats: {}, vaultMonsters: [],
    activeMonsters: [mk(901), mk(902), mk(903), mk(904)] }; // 4 monsters to loot
  const world = {
    pvps: new Map([["p1", true]]),
    rounds: new Map(),
    sessions: new Map([["W", { profile: winP }], ["L", { profile: loseP }]]),
  };
  endPvp(world, { pvpId: "p1", roundId: "r1", a: { id: "W" }, b: { id: "L" } }, "a", "ko", () => {});
  assert.equal(winP.vaultMonsters.length, GAME.VAULT_SIZE); // capped (was 100 + 4 looted)
});

// A simultaneous double-KO ends the duel as a DRAW (winner null). Both active teams are
// wiped, so — like the decisive loser path / the Q10 death stake — each player must lose the
// fainted team and refill from their own vault (or fresh starters), not be stranded with an
// all-fainted team. (Stranded = can't fight, yet can extract for a free heal: the exploit.)
test("PvP draw (double-KO) refills BOTH wiped teams from the vault (Q10)", () => {
  loadData(); // rollStarters (B's empty-vault fallback) needs game data
  const dead = (n) => ({ id: `d${n}`, typeName: "X", name: `dead${n}`, level: 1, currentHealth: 0, currentEnergy: 0, status: "poisoned" });
  const fresh = (n) => ({ id: `v${n}`, typeName: "X", name: `vault${n}`, level: 1, currentHealth: 30, currentEnergy: 30, status: null });
  const aP = { name: "A", stats: {}, activeMonsters: [dead(1)], vaultMonsters: [fresh(1), fresh(2)] };
  const bP = { name: "B", stats: {}, activeMonsters: [dead(2)], vaultMonsters: [] }; // empty vault → starters
  const world = {
    pvps: new Map([["p1", true]]),
    rounds: new Map(),
    sessions: new Map([["A", { profile: aP }], ["B", { profile: bP }]]),
  };
  const pvp = { pvpId: "p1", roundId: "r1", a: { id: "A", team: aP.activeMonsters }, b: { id: "B", team: bP.activeMonsters } };
  endPvp(world, pvp, null, "draw", () => {});
  // A refilled from its vault; the fainted monster is gone (the death stake).
  assert.ok(aP.activeMonsters.some((m) => m.currentHealth > 0), "A refilled to a usable team");
  assert.ok(!aP.activeMonsters.some((m) => m.id === "d1"), "A's fainted active monster was lost");
  // B had an empty vault → fresh Lv.1 starters (never stranded with nothing).
  assert.ok(bP.activeMonsters.some((m) => m.currentHealth > 0), "B refilled to starters");
  assert.ok(!bP.activeMonsters.some((m) => m.id === "d2"), "B's fainted active monster was lost");
});

// FGT-T1: combat is AI-only. With NO AI key the judge is offline, so a collision
// must NOT silently start a deterministic duel — startPvp no-ops (revised from the
// old "engine fallback" contract). Prod always has the key; this is the dev guard.
test("P3-T5: with no AI key a collision does NOT start a duel (AI-only gating)", async () => {
  loadData();
  const send = () => {};
  const world = createWorld({ minPlayers: 2, countdownTicks: 1, circleStartS: 9999, pvpEnabled: true });
  const A = { ws: { readyState: 1 }, playerId: null };
  const B = { ws: { readyState: 1 }, playerId: null };
  for (const c of [A, B]) {
    handleMessage(world, c, { t: "join", nickname: "p" }, send);
    handleMessage(world, c, { t: "queue" }, send);
  }
  tickWorld(world, 0.066, send);
  const deadline = Date.now() + 9000;
  while (![...world.rounds.values()].some((r) => r.phase === "active")) {
    if (Date.now() > deadline) throw new Error("round never active");
    await sleep(20);
  }
  const round = [...world.rounds.values()].find((r) => r.phase === "active");
  const rpA = round.players.get(A.playerId), rpB = round.players.get(B.playerId);
  rpA.x = 1000; rpA.y = 1000; rpB.x = 1010; rpB.y = 1000; // colliding

  const origKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY; // no judge → AI-only gating should block the duel
  try {
    tickWorld(world, 0.066, send); // collision pass — but no key
    assert.ok(!rpA.inPvp, "A not pulled into a duel");
    assert.ok(!rpB.inPvp, "B not pulled into a duel");
    assert.equal(world.pvps.size, 0, "no duel created without the AI judge");
  } finally {
    if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey;
  }
});

// Two players in one round, PvP enabled, collide → duel → KO → winner loots.
test("P3-T5: collision starts a duel and a KO transfers loot (mocked AI)", async () => {
  loadData();
  const send = () => {};
  const world = createWorld({ minPlayers: 2, countdownTicks: 1, circleStartS: 9999, pvpEnabled: true });
  const A = { ws: { readyState: 1 }, playerId: null };
  const B = { ws: { readyState: 1 }, playerId: null };
  for (const c of [A, B]) {
    handleMessage(world, c, { t: "join", nickname: "p" }, send);
    handleMessage(world, c, { t: "queue" }, send);
  }
  tickWorld(world, 0.066, send);
  const deadline = Date.now() + 9000;
  while (![...world.rounds.values()].some((r) => r.phase === "active")) {
    if (Date.now() > deadline) throw new Error("round never active");
    await sleep(20);
  }
  const round = [...world.rounds.values()].find((r) => r.phase === "active");
  const sA = world.sessions.get(A.playerId), sB = world.sessions.get(B.playerId);

  // Give B a single low-HP monster so one KO wipes their team.
  sB.profile.activeMonsters = [{ id: "b1", typeName: sB.profile.activeMonsters[0].typeName, name: "Loot Target", level: 1, currentHealth: 5, currentEnergy: 50, status: null }];
  const rpA = round.players.get(A.playerId), rpB = round.players.get(B.playerId);
  rpA.x = 1000; rpA.y = 1000; rpB.x = 1010; rpB.y = 1000; // colliding

  const origKey = process.env.OPENAI_API_KEY, origFetch = global.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  await setAiConfig({ combatJudgeV2: false }); // mock below is the v1 absolute-value shape
  // AI result KOs the opponent ("enemy") of whoever's POV; B's monster drops to 0.
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({
      playerMonster: { currentHealth: 100, currentEnergy: 40, status: null },
      enemyMonster: { currentHealth: 0, currentEnergy: 40, status: null },
      narrative: "KO!",
    }) } }] }),
  });
  try {
    tickWorld(world, 0.066, send); // collision → duel starts
    const pvpId = rpA.inPvp;
    assert.ok(pvpId, "A entered a duel");
    assert.equal(rpB.inPvp, pvpId, "B is in the same duel");
    assert.equal(world.pvps.size, 1);

    handleMessage(world, A, { t: "combatAction", combatId: pvpId, action: { kind: "skip" } }, send);
    handleMessage(world, B, { t: "combatAction", combatId: pvpId, action: { kind: "skip" } }, send);
    await sleep(40); // let the async AI turn resolve

    assert.equal(world.pvps.size, 0, "duel ended");
    assert.equal(rpA.inPvp, null, "A released");
    assert.equal(rpB.inPvp, null, "B released");
    assert.ok((sA.profile.vaultMonsters || []).some((m) => m.name === "Loot Target"), "winner looted the loser's team");
    assert.ok(sB.profile.activeMonsters.length > 0, "loser refilled to a usable team");
    assert.ok(!sB.profile.activeMonsters.some((m) => m.id === "b1"), "loser no longer has the looted monster");
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
    global.fetch = origFetch;
    await setAiConfig({ combatJudgeV2: "" }); // restore the default (ON)
  }
});

// Task 48 (PvP snapshot gaps): combatStart AND each combatUpdate must carry the FULL fresh
// team + activeIdx + attacks, so a faint→promote (advance) doesn't leave the client showing
// the fainted monster's moves. Also exercises the unguessable duel id (task 49).
test("task 48/49: PvP messages carry fresh team/activeIdx/attacks; duel id is unguessable", async () => {
  loadData();
  const sent = [];
  const send = (ws, m) => sent.push(m);
  const world = createWorld({ minPlayers: 2, countdownTicks: 1, circleStartS: 9999, pvpEnabled: true });
  const A = { ws: { readyState: 1 }, playerId: null };
  const B = { ws: { readyState: 1 }, playerId: null };
  for (const c of [A, B]) { handleMessage(world, c, { t: "join", nickname: "p" }, send); handleMessage(world, c, { t: "queue" }, send); }
  tickWorld(world, 0.066, send);
  const deadline = Date.now() + 9000;
  while (![...world.rounds.values()].some((r) => r.phase === "active")) { if (Date.now() > deadline) throw new Error("round never active"); await sleep(20); }
  const round = [...world.rounds.values()].find((r) => r.phase === "active");
  const rpA = round.players.get(A.playerId), rpB = round.players.get(B.playerId);
  rpA.x = 1000; rpA.y = 1000; rpB.x = 1010; rpB.y = 1000; // colliding

  const origKey = process.env.OPENAI_API_KEY, origFetch = global.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
    playerMonster: { currentHealth: 80, currentEnergy: 40, status: null },
    enemyMonster: { currentHealth: 80, currentEnergy: 40, status: null }, // both survive → combatUpdate, not End
    narrative: "clash",
  }) } }] }) });
  try {
    sent.length = 0;
    tickWorld(world, 0.066, send); // collision → duel starts → combatStart x2
    const starts = sent.filter((m) => m.t === "combatStart");
    assert.equal(starts.length, 2, "both sides get combatStart");
    for (const m of starts) {
      assert.ok(Array.isArray(m.team) && m.team.length >= 1, "combatStart carries the full team");
      assert.equal(typeof m.activeIdx, "number", "combatStart carries activeIdx");
      assert.ok(Array.isArray(m.attacks), "combatStart carries attacks");
    }
    const pvpId = rpA.inPvp;
    assert.match(pvpId, /^v[0-9a-f]{18}$/, "duel id is an unguessable CSPRNG hex, not sequential v1/v2");

    sent.length = 0;
    handleMessage(world, A, { t: "combatAction", combatId: pvpId, action: { kind: "skip" } }, send);
    handleMessage(world, B, { t: "combatAction", combatId: pvpId, action: { kind: "skip" } }, send);
    await sleep(50); // let the async AI turn resolve
    const updates = sent.filter((m) => m.t === "combatUpdate" && !m.waiting);
    assert.ok(updates.length >= 2, "both sides get a resolved combatUpdate");
    for (const m of updates) {
      assert.ok(Array.isArray(m.team), "combatUpdate carries fresh team");
      assert.ok(Array.isArray(m.attacks), "combatUpdate carries fresh attacks (no stale-after-advance)");
    }
    // A non-string combatId must be ignored (task 49 input validation) — no throw, no effect.
    handleMessage(world, A, { t: "combatAction", combatId: { evil: 1 }, action: { kind: "skip" } }, send);
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
    global.fetch = origFetch;
  }
});

// Capture is disabled in PvP: a forged catch action must be rejected outright, not
// stored as a silent no-op "pass" turn (the client never offers Catch in a duel).
test("FGT-T6: a catch action is rejected in PvP (capture disabled)", async () => {
  const sent = [];
  const pvp = { pvpId: "v1", resolving: false, a: { id: "A", action: null }, b: { id: "B", action: null } };
  const world = { pvps: new Map([["v1", pvp]]), sessions: new Map() };
  await handlePvpAction(world, pvp, "A", { kind: "catch" }, (ws, m) => sent.push(m));
  assert.equal(pvp.a.action, null, "catch is NOT stored as side A's chosen action");
  assert.equal(sent.length, 0, "no combatUpdate is emitted for a rejected catch");
});

// FGT-T9 rule 2: a collision duel (no thrower) picks first-turn initiative with a
// server-authoritative SEEDED coin-flip — so it's one of the two players and matches
// the deterministic seed (not null/speed-order, and not client-influenced).
test("FGT-T9: a collision duel sets a seeded coin-flip initiator", async () => {
  loadData();
  const send = () => {};
  const world = createWorld({ minPlayers: 2, countdownTicks: 1, circleStartS: 9999, pvpEnabled: true });
  const A = { ws: { readyState: 1 }, playerId: null };
  const B = { ws: { readyState: 1 }, playerId: null };
  for (const c of [A, B]) {
    handleMessage(world, c, { t: "join", nickname: "p" }, send);
    handleMessage(world, c, { t: "queue" }, send);
  }
  tickWorld(world, 0.066, send);
  const deadline = Date.now() + 9000;
  while (![...world.rounds.values()].some((r) => r.phase === "active")) {
    if (Date.now() > deadline) throw new Error("round never active");
    await sleep(20);
  }
  const round = [...world.rounds.values()].find((r) => r.phase === "active");
  const rpA = round.players.get(A.playerId), rpB = round.players.get(B.playerId);
  rpA.x = 1000; rpA.y = 1000; rpB.x = 1010; rpB.y = 1000; // colliding

  const origKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key"; // AI-only gate: a duel only starts with a judge
  try {
    const nextPvpBefore = world.nextPvp; // the counter used in the coin-flip seed
    tickWorld(world, 0.066, send); // collision → duel
    const pvpId = rpA.inPvp;
    assert.ok(pvpId, "duel started");
    const pvp = world.pvps.get(pvpId);
    // A joined before B, so the collision pair is (A, B) in insertion order.
    const expected = makeRng(hashString(`${round.roundId}:${A.playerId}:${B.playerId}:${nextPvpBefore}`)).next() < 0.5 ? A.playerId : B.playerId;
    assert.equal(pvp.initiatorId, expected, "initiator is the seeded coin-flip winner");
    assert.ok(pvp.initiatorId === A.playerId || pvp.initiatorId === B.playerId, "initiator is one of the two duelists");
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
  }
});
