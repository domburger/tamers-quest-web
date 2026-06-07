import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterType, getAttacksForMonster } from "../src/engine/gamedata.js";
import { createWorld, handleMessage, tickWorld } from "./world.js";
import { endPvp } from "./pvp.js";
import { GAME } from "../src/engine/schemas.js";

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

// Turning PvP on requires it to resolve WITHOUT an AI key — the deterministic
// engine fallback (revised from the original "AI-only, else cancel").
test("P3-T5: a duel resolves to a winner with no AI key (engine fallback)", async () => {
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
  sB.profile.activeMonsters = [{ id: "b1", typeName: sB.profile.activeMonsters[0].typeName, name: "Prey", level: 1, currentHealth: 1, currentEnergy: 50, status: null }];
  const rpA = round.players.get(A.playerId), rpB = round.players.get(B.playerId);
  rpA.x = 1000; rpA.y = 1000; rpB.x = 1010; rpB.y = 1000; // colliding

  const origKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY; // force the engine fallback (no AI)
  try {
    tickWorld(world, 0.066, send); // collision → duel
    const pvpId = rpA.inPvp;
    assert.ok(pvpId, "duel started");
    const atkA = getAttacksForMonster(getMonsterType(sA.profile.activeMonsters[0].typeName))[0]?.name;
    for (let i = 0; i < 30 && world.pvps.size > 0; i++) {
      handleMessage(world, A, { t: "combatAction", combatId: pvpId, action: atkA ? { kind: "attack", attackName: atkA } : { kind: "skip" } }, send);
      handleMessage(world, B, { t: "combatAction", combatId: pvpId, action: { kind: "skip" } }, send);
      await sleep(8);
    }
    assert.equal(world.pvps.size, 0, "duel resolved without AI (engine fallback)");
    assert.equal(rpA.inPvp, null, "A released");
    assert.equal(rpB.inPvp, null, "B released");
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
  }
});
