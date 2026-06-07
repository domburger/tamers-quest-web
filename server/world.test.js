import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes } from "../src/engine/gamedata.js";
import { getMonsterStats } from "../src/engine/stats.js";
import { GAME } from "../src/engine/schemas.js";
import { createWorld, handleMessage, removePlayer, tickWorld, applyRoster, broadcastToRound, spawnPortal } from "./world.js";

function loadData() {
  const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"), attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"), items: read("item.json"),
    spiritChains: read("spiritchains.json"),
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

test("broadcastToRound sends to every connected player in the round (P8-T5 kill feed)", () => {
  const sent = [];
  const send = (ws, obj) => sent.push({ ws, obj });
  const wsA = { readyState: 1 }, wsB = { readyState: 1 };
  const world = { sessions: new Map([["a", { ws: wsA }], ["b", { ws: wsB }], ["c", { ws: null }]]) };
  const round = { players: new Map([["a", {}], ["b", {}], ["c", {}], ["gone", {}]]) };
  broadcastToRound(world, round, { t: "killfeed", victim: "X", cause: "pvp" }, send);
  assert.equal(sent.length, 2, "a+b receive; c has no ws, 'gone' has no session");
  assert.deepEqual(sent.map((s) => s.ws), [wsA, wsB]);
  assert.ok(sent.every((s) => s.obj.t === "killfeed"));
  broadcastToRound(world, null, { t: "killfeed" }, send); // no round → no-op
  assert.equal(sent.length, 2);
});

test("applyRoster: chosen ids become active, rest fall to vault, ≥1 enforced, capped", () => {
  const mk = (id) => ({ id, typeName: "X", level: 1, currentHealth: 10 });
  const p = { activeMonsters: [mk("a"), mk("b")], vaultMonsters: [mk("c"), mk("d"), mk("e")] };
  assert.equal(applyRoster(p, ["c", "e", "a"]), true);
  assert.deepEqual(p.activeMonsters.map((m) => m.id), ["c", "e", "a"]);
  assert.deepEqual(p.vaultMonsters.map((m) => m.id).sort(), ["b", "d"]);
  // empty / all-unknown active is rejected with no mutation
  const snap = JSON.stringify(p);
  assert.equal(applyRoster(p, []), false);
  assert.equal(applyRoster(p, ["nope"]), false);
  assert.equal(JSON.stringify(p), snap);
  // dedup + unknown-id skip + cap at TEAM_SIZE
  assert.equal(applyRoster(p, ["c", "c", "b", "d", "a", "e", "zzz"]), true);
  assert.equal(p.activeMonsters.length, GAME.TEAM_SIZE);
});

test("applyRoster: vault cap respects the Deep Vault upgrade (not just base VAULT_SIZE)", () => {
  const mk = (id) => ({ id: `m${id}`, typeName: "X", level: 1, currentHealth: 10 });
  // One active + an over-base vault; Deep Vault L2 raises the cap to base + 2*25.
  const vault = Array.from({ length: GAME.VAULT_SIZE + 60 }, (_, i) => mk(i));
  const p = { activeMonsters: [mk("act")], vaultMonsters: vault, upgrades: { deepVault: 2 } };
  assert.equal(applyRoster(p, ["mact"]), true);
  assert.equal(p.vaultMonsters.length, GAME.VAULT_SIZE + 50, "kept up to base+2*25, not trimmed to base");
  // Without the upgrade, the same reorder caps at the base size.
  const p2 = { activeMonsters: [mk("act")], vaultMonsters: Array.from({ length: GAME.VAULT_SIZE + 60 }, (_, i) => mk(i)), upgrades: {} };
  assert.equal(applyRoster(p2, ["mact"]), true);
  assert.equal(p2.vaultMonsters.length, GAME.VAULT_SIZE);
});

test("setRoster reorders when idle (roster ok), and is locked once not idle", () => {
  const { world, conn, sent, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: "R" }, send);
  const prof = world.sessions.get(conn.playerId).profile;
  prof.vaultMonsters = [{ id: "v1", typeName: prof.activeMonsters[0].typeName, level: 2, currentHealth: 5 }];
  const rest = prof.activeMonsters.slice(1).map((m) => m.id);
  handleMessage(world, conn, { t: "setRoster", activeIds: [...rest, "v1"] }, send);
  const r = lastOf(sent, "roster");
  assert.equal(r.ok, true);
  assert.ok(r.team.some((m) => m.id === "v1"), "vault monster is now fielded");
  handleMessage(world, conn, { t: "queue" }, send); // now queued, not idle
  handleMessage(world, conn, { t: "setRoster", activeIds: ["v1"] }, send);
  const r2 = lastOf(sent, "roster");
  assert.equal(r2.ok, false);
  assert.equal(r2.locked, true);
});

test("getRoster echoes the current team + vault", () => {
  const { world, conn, sent, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: "G" }, send);
  world.sessions.get(conn.playerId).profile.vaultMonsters = [{ id: "z", typeName: "X", level: 1 }];
  handleMessage(world, conn, { t: "getRoster" }, send);
  const r = lastOf(sent, "roster");
  assert.ok(r.team.length >= 1);
  assert.deepEqual(r.vault.map((m) => m.id), ["z"]);
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

test("collision uses the body radius — the player's leading edge never enters a wall (PT2-T06)", async () => {
  const { world, conn, send, round } = await activeRound();
  const rp = round.players.get(conn.playerId);
  const E = GAME.EFFECTIVE_TILE, R = GAME.PLAYER_RADIUS;
  const walk = (x, y) => !!round.map.voidMap[Math.floor(x / E)]?.[Math.floor(y / E)];
  let edgeViolations = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let i = 0; i < 70; i++) {
      handleMessage(world, conn, { t: "input", type: "move", payload: { dx, dy } }, send);
      tickWorld(world, 0.066, send);
      // The body edge in the heading (not just the center) must stay walkable —
      // the collider matches the rendered body, so it can't poke into a wall tile.
      if (!walk(rp.x + dx * R, rp.y + dy * R)) edgeViolations++;
    }
  }
  assert.equal(edgeViolations, 0, "the player's body edge never overlaps a wall tile");
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
  // P8-T1 stats: a run was counted and the extraction recorded.
  assert.equal(ex.stats.extractions, 1);
  assert.ok(ex.stats.runs >= 1);
});

test("round start heals the active team to full (PT2-T04: no damaged teammate on a fresh run)", async () => {
  loadData();
  const sent = [];
  const send = (ws, obj) => sent.push(obj);
  const world = createWorld({ minPlayers: 1, countdownTicks: 1, circleStartS: 9999 });
  const conn = { ws: { readyState: 1 }, playerId: null };
  handleMessage(world, conn, { t: "join", nickname: "Tester" }, send);
  const s = world.sessions.get(conn.playerId);
  // Wound the whole team BEFORE the round forms — simulates the reported bug:
  // a vault monster caught at low HP (or a death-refilled team) carrying stale
  // damage into the next run.
  for (const m of s.profile.activeMonsters) m.currentHealth = 1;
  handleMessage(world, conn, { t: "queue" }, send);
  tickWorld(world, 0.066, send); // forms the round → generateRound heals on spawn
  const deadline = Date.now() + 9000;
  while (![...world.rounds.values()].some((r) => r.phase === "active")) {
    if (Date.now() > deadline) throw new Error("round never became active");
    await sleep(20);
  }
  for (const m of s.profile.activeMonsters) {
    const max = getMonsterStats(getMonsterTypes().find((t) => t.typeName === m.typeName), m.level).health;
    assert.equal(m.currentHealth, max, `${m.typeName} should be healed to full at round start`);
  }
});

test("spirit chain: throwing at a monster spawns a projectile, then engages with player initiative", async () => {
  const { world, conn, send, round, sent } = await activeRound();
  const id = conn.playerId;
  const rp = round.players.get(id);
  const prof = world.sessions.get(id).profile;
  assert.equal(prof.equippedChainId, "tier1");
  const startThrows = prof.chains[0].throwCount;

  // Isolate the throw path: one monster ~60px to the right (beyond the 44px
  // walk-into radius, within tier1's 160px range), nothing else on the map.
  const t = getMonsterTypes()[0];
  round.monsters = [{ id: "mob1", typeName: t.typeName, level: 2, x: rp.x + 60, y: rp.y, hidden: false }];

  handleMessage(world, conn, { t: "input", type: "throw", payload: { dx: 1, dy: 0, chainId: "tier1" } }, send);
  // First tick spawns the projectile; subsequent ticks fly it into the monster.
  let combatStart = null;
  for (let i = 0; i < 8 && !combatStart; i++) {
    tickWorld(world, 0.066, send);
    combatStart = lastOf(sent, "combatStart");
  }
  assert.ok(combatStart, "combat started from the thrown chain");
  assert.ok(rp.inCombat, "player is locked into combat");
  assert.equal(prof.chains[0].throwCount, startThrows - 1, "a throw was consumed");

  const session = world.combats.get(rp.inCombat);
  assert.equal(session.initiator, "player", "thrower gets first-turn initiative");
  assert.equal(session.chainId, "tier1", "engaging chain recorded for capture");
  assert.equal(round.projectiles.length, 0, "projectile consumed on hit");
});

test("spirit chain: opening a loot chest grants its loot (run-found) and removes the chest", async () => {
  const { world, conn, send, round, sent } = await activeRound();
  const id = conn.playerId;
  const rp = round.players.get(id);
  const prof = world.sessions.get(id).profile;

  // Place a chest holding a non-starter chain (the 5-chain starter set owns tier1-5,
  // so use a special the player doesn't start with) on the player; tick to open it.
  round.chests = [{ id: "chX", x: rp.x, y: rp.y, loot: ["endless"] }];
  assert.ok(!prof.chains.some((c) => c.chainId === "endless"), "doesn't own endless yet");
  tickWorld(world, 0.066, send);
  const got = prof.chains.find((c) => c.chainId === "endless");
  assert.ok(got, "endless granted from the chest");
  assert.equal(got.runFound, true, "chest loot is provisional (run-found)");
  assert.equal(round.chests.length, 0, "chest consumed");

  // The next snapshot reflects the enlarged inventory; chests don't leak loot.
  tickWorld(world, 0.066, send);
  const snap = sent.filter((m) => m.t === "snapshot" && m.you?.id === id).pop();
  assert.ok(snap.you.chains.some((c) => c.chainId === "endless"), "snapshot carries the new chain");
});

test("sprint: holding shift drains stamina while moving; releasing regenerates it", async () => {
  const { world, conn, send, round } = await activeRound();
  const rp = round.players.get(conn.playerId);
  round.monsters = []; // isolate from combat: spawning near a monster would lock movement
                       // mid-sprint (rp.inCombat → moving=false → no drain), flaking this test
  assert.equal(rp.stamina, GAME.SPRINT.STAMINA_MAX, "spawns with full stamina");

  // Sprint for several ticks → stamina drops, server marks it sprinting.
  for (let i = 0; i < 5; i++) {
    handleMessage(world, conn, { t: "input", type: "move", payload: { dx: 1, dy: 0, sprint: true } }, send);
    tickWorld(world, 0.1, send);
  }
  assert.ok(rp.stamina < GAME.SPRINT.STAMINA_MAX, "sprinting drained stamina");
  const drained = rp.stamina;

  // Idle (no input) → stamina regenerates back up.
  tickWorld(world, 0.5, send);
  assert.ok(rp.stamina > drained, "stamina regenerates while not sprinting");

  // Moving WITHOUT shift does not drain (regenerates or holds at max).
  rp.stamina = 50;
  handleMessage(world, conn, { t: "input", type: "move", payload: { dx: 1, dy: 0, sprint: false } }, send);
  tickWorld(world, 0.1, send);
  assert.ok(rp.stamina >= 50, "walking does not drain stamina");
});

test("multi/area chain: a throw clusters nearby monsters into a combat queue", async () => {
  const { world, conn, send, round } = await activeRound();
  const id = conn.playerId;
  const rp = round.players.get(id);
  const prof = world.sessions.get(id).profile;
  prof.chains.push({ chainId: "multi", throwCount: 5, durability: 5 });
  prof.equippedChainId = "multi";

  const t = getMonsterTypes()[0];
  // Primary ~60px right of the player (beyond walk-into); a second within the
  // 120px multi radius; a third far outside it.
  const A = { id: "A", typeName: t.typeName, level: 2, x: rp.x + 60, y: rp.y, hidden: false };
  const B = { id: "B", typeName: t.typeName, level: 2, x: rp.x + 60, y: rp.y + 90, hidden: false };
  const C = { id: "C", typeName: t.typeName, level: 2, x: rp.x + 60, y: rp.y + 900, hidden: false };
  round.monsters = [A, B, C];

  handleMessage(world, conn, { t: "input", type: "throw", payload: { dx: 1, dy: 0, chainId: "multi" } }, send);
  let combatId = null;
  for (let i = 0; i < 8 && !combatId; i++) { tickWorld(world, 0.066, send); combatId = rp.inCombat; }
  assert.ok(combatId, "combat started from the multi throw");
  const session = world.combats.get(combatId);
  assert.equal(session.queue.length, 1, "one clustered monster queued (B), not the far one (C)");
  assert.equal(session.queue[0].id, "B");
  assert.ok(!round.monsters.includes(A) && !round.monsters.includes(B), "A+B left the map");
  assert.ok(round.monsters.includes(C), "the far monster stays on the map");
});

test("meta-progression: buyUpgrade spends gold and raises the level (idle only)", () => {
  const { world, conn, sent, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: "Upgrader" }, send);
  const prof = world.sessions.get(conn.playerId).profile;
  prof.gold = 5000;
  handleMessage(world, conn, { t: "buyUpgrade", upgradeId: "prospector" }, send);
  const r = lastOf(sent, "upgrades");
  assert.equal(r.ok, true);
  assert.equal(r.upgrades.prospector, 1);
  assert.ok(r.gold < 5000, "gold spent");

  // Locked once queued (between-runs only).
  handleMessage(world, conn, { t: "queue" }, send);
  handleMessage(world, conn, { t: "buyUpgrade", upgradeId: "prospector" }, send);
  assert.equal(lastOf(sent, "upgrades").locked, true);
});

test("crafting: craftChain upgrades an owned chain for essence (idle only)", () => {
  const { world, conn, sent, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: "Crafter" }, send);
  const prof = world.sessions.get(conn.playerId).profile;
  prof.essence = 500; // plenty
  // Starter is tier1; upgrade it → tier2.
  handleMessage(world, conn, { t: "craftChain", chainId: "tier1" }, send);
  const r = lastOf(sent, "shop");
  assert.equal(r.ok, true);
  assert.ok(prof.chains.some((c) => c.chainId === "tier2"), "tier2 crafted");
  assert.ok(!prof.chains.some((c) => c.chainId === "tier1"), "tier1 consumed");
  assert.ok(r.essence < 500, "essence spent");

  // Too poor → rejected with reason.
  prof.essence = 0;
  handleMessage(world, conn, { t: "craftChain", chainId: "tier2" }, send);
  assert.equal(lastOf(sent, "shop").reason, "essence");

  // Locked once queued.
  handleMessage(world, conn, { t: "queue" }, send);
  handleMessage(world, conn, { t: "craftChain", chainId: "tier2" }, send);
  assert.equal(lastOf(sent, "shop").locked, true);
});

test("multi/area chain: a failed engage (no usable monster) does not strand the cluster", async () => {
  const { world, conn, send, round } = await activeRound();
  const id = conn.playerId;
  const rp = round.players.get(id);
  const prof = world.sessions.get(id).profile;
  prof.chains.push({ chainId: "multi", throwCount: 5, durability: 5 });
  prof.equippedChainId = "multi";
  for (const m of prof.activeMonsters) m.currentHealth = 0; // whole team fainted → can't start combat

  const t = getMonsterTypes()[0];
  const A = { id: "A", typeName: t.typeName, level: 2, x: rp.x + 60, y: rp.y, hidden: false };
  const B = { id: "B", typeName: t.typeName, level: 2, x: rp.x + 60, y: rp.y + 90, hidden: false };
  round.monsters = [A, B];

  handleMessage(world, conn, { t: "input", type: "throw", payload: { dx: 1, dy: 0, chainId: "multi" } }, send);
  for (let i = 0; i < 8; i++) tickWorld(world, 0.066, send);
  assert.ok(!rp.inCombat, "combat never started (no usable monster)");
  assert.ok(round.monsters.includes(A) && round.monsters.includes(B), "clustered monsters stay on the map, not stranded");
});

test("spirit shop: buyChain deducts gold and grants the chain (only when idle)", () => {
  const { world, conn, sent, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: "Buyer" }, send);
  const prof = world.sessions.get(conn.playerId).profile;
  prof.gold = 500;
  handleMessage(world, conn, { t: "buyChain", chainId: "tier3" }, send);
  const r = lastOf(sent, "shop");
  assert.equal(r.ok, true);
  assert.equal(r.gold, 500 - 160);
  assert.ok(prof.chains.some((c) => c.chainId === "tier3"), "tier3 granted");

  // Too poor → rejected, no gold spent.
  prof.gold = 5;
  handleMessage(world, conn, { t: "buyChain", chainId: "tier5" }, send);
  assert.equal(lastOf(sent, "shop").ok, false);
  assert.equal(prof.gold, 5);

  // Locked once queued (not idle).
  handleMessage(world, conn, { t: "queue" }, send);
  prof.gold = 9999;
  handleMessage(world, conn, { t: "buyChain", chainId: "tier3" }, send);
  assert.equal(lastOf(sent, "shop").locked, true);
});

test("gold: extracting awards the run-completion bonus", async () => {
  const { world, conn, send, round, sent } = await activeRound({ circleStartS: 0, portalIntervalS: 1 });
  tickWorld(world, 0.066, send);
  const s = world.sessions.get(conn.playerId);
  const before = s.profile.gold || 0;
  const rp = round.players.get(conn.playerId);
  const p = round.portals[0]; rp.x = p.x; rp.y = p.y;
  tickWorld(world, 0.066, send);
  assert.ok(lastOf(sent, "extracted"), "extracted");
  assert.equal(s.profile.gold, before + GAME.GOLD.PER_EXTRACT);
});

test("spirit chain: run-found chains are kept on extract and lost on death", async () => {
  // Extract path keeps them.
  {
    const { world, conn, send, round, sent } = await activeRound({ circleStartS: 0, portalIntervalS: 1 });
    tickWorld(world, 0.066, send); // spawn a portal
    const s = world.sessions.get(conn.playerId);
    s.profile.chains.push({ chainId: "guaranteed", throwCount: 3, durability: 3, runFound: true });
    const rp = round.players.get(conn.playerId);
    const p = round.portals[0]; rp.x = p.x; rp.y = p.y;
    tickWorld(world, 0.066, send);
    assert.ok(lastOf(sent, "extracted"), "extracted");
    const kept = s.profile.chains.find((c) => c.chainId === "guaranteed");
    assert.ok(kept && !kept.runFound, "run-found chain banked (flag cleared) on extract");
  }
  // Death path drops them.
  {
    const { world, conn, send, round, sent } = await activeRound();
    const s = world.sessions.get(conn.playerId);
    s.profile.chains.push({ chainId: "guaranteed", throwCount: 3, durability: 3, runFound: true });
    round.startedAtMs = Date.now() - (world.cfg.roundDurationS + 5) * 1000; // force timeout death
    tickWorld(world, 0.066, send);
    assert.ok(lastOf(sent, "died"), "died");
    assert.ok(!s.profile.chains.some((c) => c.chainId === "guaranteed"), "run-found chain lost on death");
    assert.ok(s.profile.chains.length >= 1, "still has a usable (banked) chain");
  }
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

test("P6-T1: disconnect keeps the player in the round during the grace window", async () => {
  const { world, conn, round } = await activeRound();
  removePlayer(world, conn.playerId);
  const s = world.sessions.get(conn.playerId);
  assert.ok(s && s.disconnected, "session kept and marked disconnected");
  assert.ok(round.players.has(conn.playerId), "round slot preserved during grace");
});

test("P6-T1: reconnecting within grace resumes the round at the current position", async () => {
  const { world, conn, round } = await activeRound();
  const id = conn.playerId;
  const token = world.sessions.get(id).profile.token;
  const rp = round.players.get(id);
  rp.x = 1234; rp.y = 5678;
  removePlayer(world, id);

  const sent2 = [];
  const send2 = (ws, obj) => sent2.push(obj);
  const conn2 = { ws: { readyState: 1 }, playerId: null };
  handleMessage(world, conn2, { t: "join", token }, send2);

  const s = world.sessions.get(id);
  assert.ok(s && !s.disconnected, "session live again");
  assert.equal(conn2.playerId, id, "same player id resumed");
  const rs = sent2.filter((m) => m.t === "roundStart").pop();
  assert.ok(rs?.resumed, "roundStart with resumed flag");
  assert.equal(rs.spawn.x, 1234, "resumed at current x");
  assert.ok(round.players.has(id), "still in the round");
});

test("P6-T1: not reconnecting within grace counts as a death (Q12 → Q10 penalty)", async () => {
  const { world, conn, round } = await activeRound();
  const id = conn.playerId;
  const s = world.sessions.get(id);
  s.profile.vaultMonsters = [{ id: "v1", typeName: s.profile.activeMonsters[0].typeName, level: 9, currentHealth: 10 }];
  removePlayer(world, id);
  world.sessions.get(id).disconnectedAt = Date.now() - 130000; // force grace expiry (>120s)
  tickWorld(world, 0.066, () => {});
  assert.ok(!world.sessions.has(id), "session dropped after grace");
  assert.ok(!round.players.has(id), "removed from the round");
  assert.equal(s.profile.activeMonsters[0].id, "v1", "active team lost, refilled from vault (Q10)");
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

test("spawnPortal places deterministically from the round seed (GP-8)", () => {
  const E = GAME.EFFECTIVE_TILE, N = 200;
  const mkRound = (seed) => ({
    seed, circleRadius: 20 * E, mapSize: N, portals: [],
    map: { voidMap: Array.from({ length: N }, () => new Array(N).fill(true)) }, // fully walkable
  });
  const cx = (N / 2) * E, cy = (N / 2) * E; // map center, world-space
  const place = (round) => { for (let i = 0; i < 6; i++) assert.ok(spawnPortal(round, cx, cy), "portal placed"); return round.portals; };

  const a = place(mkRound(13579)), b = place(mkRound(13579)), c = place(mkRound(24680));
  assert.deepEqual(a, b, "same seed → identical portals (reproducible, not Math.random)");
  assert.notDeepEqual(a, c, "different seed → different portals (placement uses the seed)");
});

test("spawnPortal spreads the first 4 portals across quadrants (GP-7)", () => {
  const E = GAME.EFFECTIVE_TILE, N = 200;
  const round = {
    seed: 4242, circleRadius: 60 * E, mapSize: N, portals: [],
    map: { voidMap: Array.from({ length: N }, () => new Array(N).fill(true)) },
  };
  const cx = (N / 2) * E, cy = (N / 2) * E;
  for (let i = 0; i < 4; i++) assert.ok(spawnPortal(round, cx, cy), "portal placed");
  // Classify each portal by its angle-sector from center — far-edge players in any
  // quadrant should have a portal, so the first 4 must cover all 4.
  const sector = (p) => { let a = Math.atan2(p.y - cy, p.x - cx); if (a < 0) a += 2 * Math.PI; return Math.floor(a / (Math.PI / 2)) % 4; };
  const quads = new Set(round.portals.map(sector));
  assert.equal(quads.size, 4, `first 4 portals should cover 4 quadrants, got ${quads.size}`);
});

test("setSkin stores a valid cosmetic id and rejects abuse (CN-12)", () => {
  const { world, conn, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: "Skin" }, send);
  const prof = world.sessions.get(conn.playerId).profile;
  handleMessage(world, conn, { t: "setSkin", skinId: "ember" }, send);
  assert.equal(prof.equippedSkinId, "ember", "valid id stored");
  handleMessage(world, conn, { t: "setSkin", skinId: "x".repeat(50) }, send); // too long → ignored
  assert.equal(prof.equippedSkinId, "ember", "over-long id rejected (keeps last valid)");
  handleMessage(world, conn, { t: "setSkin", skinId: "<script>" }, send); // bad chars → ignored
  assert.equal(prof.equippedSkinId, "ember", "non-token id rejected");
});

test("combatAction from a stale cross-round combat is rejected (NC-11)", () => {
  const { world, conn, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: "X" }, send);
  const s = world.sessions.get(conn.playerId);
  s.state = "in_round"; s.roundId = "rB"; // the player is now in round rB
  // A stale combat left over from a previous round (rA), still keyed by its id.
  world.combats.set("cm1", { combatId: "cm1", playerId: conn.playerId, roundId: "rA", resolving: false });
  handleMessage(world, conn, { t: "combatAction", combatId: "cm1", action: { kind: "flee" } }, send);
  assert.equal(world.combats.get("cm1").resolving, false, "cross-round combatAction rejected (combat not resolved)");
});
