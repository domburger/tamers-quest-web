import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes, getMonsterType, getSpiritChains, addItem } from "../src/engine/gamedata.js";
import { getMonsterStats } from "../src/engine/stats.js";
import { GAME } from "../src/engine/schemas.js";
import { makeRng } from "../src/engine/rng.js";
import { createWorld, handleMessage, removePlayer, tickWorld, applyRoster, broadcastToRound, spawnPortal, computeRunGains, runStartSnapshot, recordPosHistory, rewindMonsters, runAtRisk } from "./world.js";

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

async function activeRound(cfgOverride = {}) {
  loadData();
  const sent = [];
  const send = (ws, obj) => sent.push(obj);
  const world = createWorld({ minPlayers: 1, countdownTicks: 1, circleStartS: 9999, ...cfgOverride });
  const conn = { ws: { readyState: 1 }, playerId: null };
  handleMessage(world, conn, { t: "join", nickname: "Tester" }, send);
  handleMessage(world, conn, { t: "queue" }, send);
  tickWorld(world, 0.066, send);
  const deadline = Date.now() + 9000;
  while (![...world.rounds.values()].some((r) => r.phase === "active")) {
    if (Date.now() > deadline) throw new Error("round never became active");
    await sleep(20);
  }
  const round = [...world.rounds.values()].find((r) => r.phase === "active");
  return { world, conn, sent, send, round, id: conn.playerId };
}

test("TQ-38/TQ-80 (Option C): importProfile is no longer handled — a client cannot mutate the server profile", () => {
  const { world, conn, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: "Tester" }, send);
  const s = world.sessions.get(conn.playerId);
  const goldBefore = s.profile.gold || 0;
  const essenceBefore = s.profile.essence || 0;
  const teamBefore = JSON.stringify(s.profile.activeMonsters || []);
  const chainsBefore = JSON.stringify(s.profile.chains || []);
  handleMessage(world, conn, { t: "importProfile",
    activeMonsters: [{ typeName: getMonsterTypes()[0].typeName, level: 9999, name: "Cheat", currentHealth: 1e9 }],
    gold: 1e12, essence: 1e9,
    chains: [{ chainId: getSpiritChains()[0].id, throwCount: null }],
  }, send);
  assert.equal(s.profile.gold || 0, goldBefore, "gold unchanged (no import merge)");
  assert.equal(s.profile.essence || 0, essenceBefore, "essence unchanged (premium-only, never client-merged)");
  assert.equal(JSON.stringify(s.profile.activeMonsters || []), teamBefore, "team unchanged (no import merge)");
  assert.equal(JSON.stringify(s.profile.chains || []), chainsBefore, "chains unchanged (no infinite-chain grant)");
});

test("SP/MP unify: queueSolo forms a PRIVATE 1-player round immediately (bypasses matchmaking)", async () => {
  loadData();
  const sent = [];
  const send = (ws, m) => sent.push(m);
  const world = createWorld({ minPlayers: 16, countdownTicks: 99999, circleStartS: 9999 });
  const conn = { ws: { readyState: 1 }, playerId: null };
  handleMessage(world, conn, { t: "join", nickname: "Solo" }, send);
  handleMessage(world, conn, { t: "queueSolo" }, send);
  const s = world.sessions.get(conn.playerId);
  assert.equal(s.state, "in_round", "player is in a round immediately, no countdown");
  assert.ok(sent.some((m) => m.t === "matchFound"), "matchFound emitted");
  assert.equal(world.rounds.size, 1);
  const round = [...world.rounds.values()][0];
  assert.equal(round.players.size, 1, "a private, 1-player round");
  const deadline = Date.now() + 9000;
  while (round.phase !== "active") { if (Date.now() > deadline) throw new Error("solo round never went active"); await sleep(20); }
  assert.equal(round.players.size, 1, "still solo after map gen + spawn");
});

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
  broadcastToRound(world, null, { t: "killfeed" }, send);
  assert.equal(sent.length, 2);
});

test("applyRoster: chosen ids become active, rest fall to vault, ≥1 enforced, capped", () => {
  const mk = (id) => ({ id, typeName: "X", level: 1, currentHealth: 10 });
  const p = { activeMonsters: [mk("a"), mk("b")], vaultMonsters: [mk("c"), mk("d"), mk("e")] };
  assert.equal(applyRoster(p, ["c", "e", "a"]), true);
  assert.deepEqual(p.activeMonsters.map((m) => m.id), ["c", "e", "a"]);
  assert.deepEqual(p.vaultMonsters.map((m) => m.id).sort(), ["b", "d"]);
  const snap = JSON.stringify(p);
  assert.equal(applyRoster(p, []), false);
  assert.equal(applyRoster(p, ["nope"]), false);
  assert.equal(JSON.stringify(p), snap);
  assert.equal(applyRoster(p, ["c", "c", "b", "d", "a", "e", "zzz"]), true);
  assert.equal(p.activeMonsters.length, GAME.TEAM_SIZE);
});

test("applyRoster: vault cap respects the Deep Vault upgrade (not just base VAULT_SIZE)", () => {
  const mk = (id) => ({ id: `m${id}`, typeName: "X", level: 1, currentHealth: 10 });
  const vault = Array.from({ length: GAME.VAULT_SIZE + 60 }, (_, i) => mk(i));
  const p = { activeMonsters: [mk("act")], vaultMonsters: vault, upgrades: { deepVault: 2 } };
  assert.equal(applyRoster(p, ["mact"]), true);
  assert.equal(p.vaultMonsters.length, GAME.VAULT_SIZE + 50, "kept up to base+2*25, not trimmed to base");
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
  handleMessage(world, conn, { t: "queue" }, send);
  handleMessage(world, conn, { t: "setRoster", activeIds: ["v1"] }, send);
  const r2 = lastOf(sent, "roster");
  assert.equal(r2.ok, false);
  assert.equal(r2.locked, true);
});

test("release frees a vault monster when idle: refund banked + wallet synced (INV-T7)", () => {
  const { world, conn, sent, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: "Rel" }, send);
  const prof = world.sessions.get(conn.playerId).profile;
  prof.gold = 0; prof.essence = 0;
  prof.vaultMonsters = [{ id: "junk", typeName: prof.activeMonsters[0].typeName, level: 3, currentHealth: 5 }];
  handleMessage(world, conn, { t: "release", monsterId: "junk" }, send);
  const r = lastOf(sent, "roster");
  assert.equal(r.ok, true);
  assert.equal(r.released, true);
  assert.ok(r.reward && r.reward.gold > 0, "gold reward returned (TQ-132: no essence refund)");
  assert.equal(r.reward.essence, undefined, "no essence refund — essence is premium/paid");
  assert.equal(r.gold, prof.gold, "wallet gold synced to the profile");
  assert.equal(prof.essence, 0, "essence untouched by release");
  assert.ok(!r.vault.some((m) => m.id === "junk"), "released monster gone from the vault");
});

test("release is locked mid-run and refuses the last monster (INV-T7 guards)", () => {
  const { world, conn, sent, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: "Rel2" }, send);
  const prof = world.sessions.get(conn.playerId).profile;
  prof.activeMonsters = [prof.activeMonsters[0]]; prof.vaultMonsters = [];
  handleMessage(world, conn, { t: "release", monsterId: prof.activeMonsters[0].id }, send);
  const r = lastOf(sent, "roster");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "last-monster");
  prof.vaultMonsters = [{ id: "j2", typeName: prof.activeMonsters[0].typeName, level: 1 }];
  handleMessage(world, conn, { t: "queue" }, send);
  handleMessage(world, conn, { t: "release", monsterId: "j2" }, send);
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

test("TQ-197: heal restores an injured idle team to full + echoes ok roster", () => {
  const { world, conn, sent, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: "Heal" }, send);
  const prof = world.sessions.get(conn.playerId).profile;
  for (const m of prof.activeMonsters) {
    const st = getMonsterStats(getMonsterType(m.typeName), m.level);
    m._fullHp = st.health; m._fullEn = st.energy;
    m.currentHealth = 1; m.currentEnergy = 0;
  }
  prof.activeMonsters[0].status = "poison";
  handleMessage(world, conn, { t: "heal" }, send);
  const r = lastOf(sent, "roster");
  assert.equal(r.ok, true, "heal succeeds when idle");
  assert.ok(!r.locked, "not reported locked when idle");
  for (const m of prof.activeMonsters) {
    assert.equal(m.currentHealth, m._fullHp, `${m.typeName} healed to full HP`);
    assert.equal(m.currentEnergy, m._fullEn, `${m.typeName} energy restored`);
    assert.ok(!m.status, "status cleared");
  }
  assert.ok(r.team.every((m) => m.currentHealth > 1), "echoed roster shows healed HP");
});

test("TQ-197: heal is refused (locked) when not idle — team is not altered mid-run", () => {
  const { world, conn, sent, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: "HealLock" }, send);
  const prof = world.sessions.get(conn.playerId).profile;
  prof.activeMonsters[0].currentHealth = 1;
  handleMessage(world, conn, { t: "queue" }, send);
  handleMessage(world, conn, { t: "heal" }, send);
  const r = lastOf(sent, "roster");
  assert.equal(r.ok, false);
  assert.equal(r.locked, true);
  assert.equal(prof.activeMonsters[0].currentHealth, 1, "HP untouched while locked");
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

test("join sanitizes the nickname — strips < > + control chars (SEC-A4 stored-XSS defense)", () => {
  const { world, conn, sent, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: '<img src=x onerror=alert(1)>Bob' }, send);
  const nick = lastOf(sent, "welcome").you.nickname;
  assert.ok(!nick.includes("<") && !nick.includes(">"), `angle brackets stripped (got "${nick}")`);
  assert.ok(nick.startsWith("img src=x"), "inner text survives — only the tag delimiters are gone");
  const ctx2 = newCtx();
  handleMessage(ctx2.world, ctx2.conn, { t: "join", nickname: "<<>>" }, ctx2.send);
  assert.equal(lastOf(ctx2.sent, "welcome").you.nickname, "Tamer");
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
  tickWorld(world, 0.066, send);
  assert.equal(world.rounds.size, 0);
});

test("removePlayer clears the session and the queue", () => {
  const { world, conn, send } = newCtx();
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
    handleMessage(world, conn, { t: "queue" }, send);
    handleMessage(world, conn, { t: "input", type: "move", payload: { dx: 1, dy: 0 } }, send);
    handleMessage(world, conn, { t: "combatAction", combatId: "nope", action: { kind: "attack" } }, send);
  });
  assert.equal(world.sessions.size, 0);
});

test("round goes active: roundStart spawn + snapshot carry the world state", async () => {
  const { world, sent, send, round, id } = await activeRound({ circleStartS: 0 });
  const rs = lastOf(sent, "roundStart");
  assert.ok(rs, "roundStart sent");
  const E = GAME.EFFECTIVE_TILE;
  assert.ok(round.map.voidMap[Math.floor(rs.spawn.x / E)][Math.floor(rs.spawn.y / E)], "spawn is walkable");

  tickWorld(world, 0.066, send);
  tickWorld(world, 0.066, send);
  const snap = lastOf(sent, "snapshot");
  assert.ok(snap, "snapshot sent");
  assert.equal(snap.you.id, id);
  const meta = sent.find((m) => m.t === "snapshot" && m.you?.id === id && m.youMeta);
  assert.ok(meta && Array.isArray(meta.youMeta.team) && meta.youMeta.team.length > 0, "snapshot meta has team HP");
  assert.ok(snap.circle, "snapshot has the safe zone (zone has started)");
});

test("zone lifecycle: no zone before circleStartS; then it covers the whole map from a randomized off-centre point", async () => {
  const { world, send, round } = await activeRound({ circleStartS: 5, roundDurationS: 600 });
  const E = GAME.EFFECTIVE_TILE;

  tickWorld(world, 0.066, send);
  assert.equal(round.circle, null, "no safe zone before it starts (circle is null)");
  assert.equal(round.circleRadius, 0, "no radius before the zone starts");

  round.startedAtMs = Date.now() - 5100;
  tickWorld(world, 0.066, send);
  assert.ok(round.circle, "the zone exists once circleStartS passes");

  const mapExtent = round.mapSize * E, half = mapExtent / 2, margin = half * 0.5;

  assert.ok(round.zoneCx >= half - margin - 1 && round.zoneCx <= half + margin + 1, "zone centre X within the central band");
  assert.ok(round.zoneCy >= half - margin - 1 && round.zoneCy <= half + margin + 1, "zone centre Y within the central band");
  const zr = makeRng((round.seed ^ 0x5a4f4e45) >>> 0);
  assert.equal(round.zoneCx, half + (zr.next() * 2 - 1) * margin, "centre X is the seed-derived value (replayable)");
  assert.equal(round.zoneCy, half + (zr.next() * 2 - 1) * margin, "centre Y is the seed-derived value (replayable)");

  for (const [x, y] of [[0, 0], [mapExtent, 0], [0, mapExtent], [mapExtent, mapExtent]]) {
    assert.ok(Math.hypot(x - round.zoneCx, y - round.zoneCy) <= round.zoneStartR + 1, "every map corner is within the zone's start radius");
  }
  assert.ok(round.circle.r >= round.zoneStartR * 0.99, "the zone appears at (near) its full map-covering radius");
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
      if (!walk(rp.x + dx * R, rp.y + dy * R)) edgeViolations++;
    }
  }
  assert.equal(edgeViolations, 0, "the player's body edge never overlaps a wall tile");
});

test("extraction: stepping on a portal extracts you; survivors are NOT auto-healed (TQ-203/TQ-207)", async () => {
  const { world, conn, send, round, sent } = await activeRound({ circleStartS: 0, portalIntervalS: 1 });
  tickWorld(world, 0.066, send);
  assert.ok(round.portals.length > 0, "a portal exists");
  const s = world.sessions.get(conn.playerId);
  s.profile.activeMonsters[0].currentHealth = 1;
  const rp = round.players.get(conn.playerId);
  const p = round.portals[0];
  rp.x = p.x; rp.y = p.y;
  tickWorld(world, 0.066, send);
  const ex = lastOf(sent, "extracted");
  assert.ok(ex, "extracted event sent");
  const lead = ex.team[0];
  assert.equal(lead.currentHealth, 1, "lead keeps its injured HP on extract — no auto-heal (the lobby Healer restores)");
  assert.equal(world.sessions.get(conn.playerId).state, "idle");
  assert.equal(ex.stats.extractions, 1);
  assert.ok(ex.stats.runs >= 1);
  const hist = world.sessions.get(conn.playerId).profile.matchHistory;
  assert.ok(Array.isArray(hist) && hist.length === 1, "the run is recorded in match history");
  assert.equal(hist[0].result, "extracted");
  assert.ok(typeof hist[0].at === "number" && hist[0].survivedS >= 0, "record carries a timestamp + survival time");
});

test("wild-monster approach: an 'approacher' walks into the nearby player to start a fight", async () => {
  const { world, conn, sent, send, round } = await activeRound({ circleStartS: 9999, roundDurationS: 600 });
  const N = round.mapSize, E = GAME.EFFECTIVE_TILE, c = Math.floor(N / 2) * E;
  const FLOOR = { collidable: false };
  round.map.voidMap = Array.from({ length: N }, () => new Array(N).fill(true));
  round.map.tileMap = Array.from({ length: N }, () => new Array(N).fill(FLOOR));
  const rp = round.players.get(conn.playerId);
  rp.x = c; rp.y = c;
  rp.encounterGraceUntil = 0;
  const TN = getMonsterTypes()[0].typeName;
  round.monsters = [{ id: "m_hunt", typeName: TN, level: 1, x: c + 150, y: c, hidden: false, approacher: true }];

  for (let i = 0; i < 6; i++) tickWorld(world, 0.066, send);
  const mon = round.monsters.find((m) => m.id === "m_hunt");
  assert.ok(mon, "the hunter is still roaming (hasn't reached the player yet)");
  assert.ok(mon.x < c + 150 - 5, "the hunter walked toward the player (its x decreased toward the player at c)");

  let minDist = Infinity, engaged = false;
  for (let i = 0; i < 400 && !engaged; i++) {
    tickWorld(world, 0.066, send);
    const m = round.monsters.find((x) => x.id === "m_hunt");
    if (m) minDist = Math.min(minDist, Math.hypot(m.x - rp.x, m.y - rp.y));
    engaged = !!round.players.get(conn.playerId)?.inCombat || sent.some((msg) => msg.t === "combatStart" || msg.t === "combatUnavailable");
  }
  assert.ok(minDist <= world.cfg.encounterRadius, `the hunter walked into encounter range (minDist ${minDist.toFixed(1)} <= ${world.cfg.encounterRadius})`);
  assert.ok(engaged, "reaching the player fires the encounter → a fight (AI on) / combatUnavailable (AI off in tests)");
});

test("wild-monster approach: a non-approacher, and an approacher with no player in range, stay put", async () => {
  const { world, conn, send, round } = await activeRound({ circleStartS: 9999 });
  const N = round.mapSize, E = GAME.EFFECTIVE_TILE, c = Math.floor(N / 2) * E;
  round.map.voidMap = Array.from({ length: N }, () => new Array(N).fill(true));
  const rp = round.players.get(conn.playerId);
  rp.x = c; rp.y = c;
  const TN = getMonsterTypes()[0].typeName;
  round.monsters = [
    { id: "m_still", typeName: TN, level: 1, x: c + 200, y: c, hidden: false, approacher: false },
    { id: "m_far", typeName: TN, level: 1, x: c + 1500, y: c, hidden: false, approacher: true },
  ];
  for (let i = 0; i < 8; i++) tickWorld(world, 0.066, send);
  const still = round.monsters.find((m) => m.id === "m_still");
  const far = round.monsters.find((m) => m.id === "m_far");
  assert.ok(still && still.x === c + 200 && still.y === c, "a non-approacher never moves");
  assert.ok(far && far.x === c + 1500 && far.y === c, "an approacher with no player in aggro range stays put");
});

test("zone danger: a player OUTSIDE the safe zone dies after the danger bar fills (timer, not HP)", async () => {
  const { world, conn, sent, send, round } = await activeRound({ circleStartS: 0, roundDurationS: 600, dangerFillS: 30 });
  round.monsters = [];
  const E = GAME.EFFECTIVE_TILE;
  round.zoneCx = round.zoneCy = (round.mapSize / 2) * E; round.zoneStartR = (round.mapSize / 2) * E;
  const rp = round.players.get(conn.playerId);
  rp.x = (round.mapSize - 1) * E; rp.y = (round.mapSize - 1) * E;
  rp.danger = 0;

  for (let i = 0; i < 5; i++) tickWorld(world, 0.066, send);
  assert.ok(round.players.has(conn.playerId), "not dead a moment after stepping out");
  assert.ok(rp.danger > 0 && rp.danger < 1, "danger accumulates while outside (HP is untouched — it's a timer)");

  let died = false;
  for (let i = 0; i < Math.ceil(32 / 0.066) && !died; i++) { tickWorld(world, 0.066, send); died = !round.players.has(conn.playerId); }
  assert.ok(died, "the zone kills the player once the danger bar reaches full (~30s outside)");
  const term = lastOf(sent, "died");
  assert.ok(term && term.reason === "zone", "the run ends as a 'zone' death");
});

test("zone danger: returning to safety drains the bar (full → empty over ~dangerDrainS), never kills", async () => {
  const { world, conn, send, round } = await activeRound({ circleStartS: 0, roundDurationS: 600, dangerDrainS: 10 });
  round.monsters = [];
  const E = GAME.EFFECTIVE_TILE;
  round.zoneCx = round.zoneCy = (round.mapSize / 2) * E; round.zoneStartR = (round.mapSize / 2) * E;
  const rp = round.players.get(conn.playerId);
  rp.x = (round.mapSize / 2) * E; rp.y = (round.mapSize / 2) * E;
  rp.danger = 1;

  for (let i = 0; i < 5; i++) tickWorld(world, 0.066, send);
  assert.ok(rp.danger < 1, "the bar drains while in safety");
  for (let i = 0; i < Math.ceil(11 / 0.066); i++) tickWorld(world, 0.066, send);
  assert.equal(rp.danger, 0, "a full bar clears after ~10s in safety");
  assert.ok(round.players.has(conn.playerId), "draining in safety never kills");
});

test("task 50: round start does NOT auto-heal; the free Healer (heal msg) heals to full", async () => {
  loadData();
  const sent = [];
  const send = (ws, obj) => sent.push(obj);
  const world = createWorld({ minPlayers: 1, countdownTicks: 1, circleStartS: 9999 });
  const conn = { ws: { readyState: 1 }, playerId: null };
  handleMessage(world, conn, { t: "join", nickname: "Tester" }, send);
  const s = world.sessions.get(conn.playerId);
  for (const m of s.profile.activeMonsters) m.currentHealth = 1;
  handleMessage(world, conn, { t: "heal" }, send);
  for (const m of s.profile.activeMonsters) {
    const max = getMonsterStats(getMonsterTypes().find((t) => t.typeName === m.typeName), m.level).health;
    assert.equal(m.currentHealth, max, `${m.typeName} should be healed to full by the Healer`);
  }
  for (const m of s.profile.activeMonsters) m.currentHealth = 1;
  handleMessage(world, conn, { t: "queue" }, send);
  tickWorld(world, 0.066, send);
  const deadline = Date.now() + 9000;
  while (![...world.rounds.values()].some((r) => r.phase === "active")) {
    if (Date.now() > deadline) throw new Error("round never became active");
    await sleep(20);
  }
  for (const m of s.profile.activeMonsters) {
    assert.equal(m.currentHealth, 1, `${m.typeName} keeps its run-start damage (no auto-heal)`);
  }
  sent.length = 0;
  handleMessage(world, conn, { t: "heal" }, send);
  const echo = sent.find((m) => m.t === "roster");
  assert.ok(echo && echo.locked, "heal is rejected (locked) while in a round");
});

test("spirit chain: throwing at a monster spawns a projectile, then engages with player initiative", async () => {
  const { world, conn, send, round, sent } = await activeRound();
  const id = conn.playerId;
  const rp = round.players.get(id);
  const prof = world.sessions.get(id).profile;
  assert.equal(prof.equippedChainId, "tier1");
  const startThrows = prof.chains[0].throwCount;

  const t = getMonsterTypes()[0];
  round.monsters = [{ id: "mob1", typeName: t.typeName, level: 2, x: rp.x + 60, y: rp.y, hidden: false }];

  const origKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  try {
    handleMessage(world, conn, { t: "input", type: "throw", payload: { dx: 1, dy: 0, chainId: "tier1" } }, send);
    let combatStart = null;
    for (let i = 0; i < 8 && !combatStart; i++) {
      tickWorld(world, 0.066, send);
      combatStart = lastOf(sent, "combatStart");
    }
    assert.ok(combatStart, "combat started from the thrown chain");
    assert.ok(rp.inCombat, "player is locked into combat");
    assert.equal(prof.chains[0].throwCount, startThrows, "throwing on the map is free (boomerang) — no throw consumed");

    const session = world.combats.get(rp.inCombat);
    assert.equal(session.initiator, "player", "thrower gets first-turn initiative");
    assert.equal(session.chainId, "tier1", "engaging chain recorded for capture");
    assert.equal(round.projectiles.length, 0, "projectile consumed on hit");
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
  }
});

test("a thrown chain landing during a PvP duel does not start a second (PvE) fight", async () => {
  const { world, conn, sent, send, round } = await activeRound();
  const id = conn.playerId;
  const rp = round.players.get(id);
  const t = getMonsterTypes()[0];
  round.monsters = [{ id: "mobX", typeName: t.typeName, level: 2, x: rp.x, y: rp.y, hidden: false }];
  rp.inPvp = "duel_x";
  round.projectiles = [{ id: "pr_dz", owner: id, x: rp.x, y: rp.y, vx: 0, vy: 0, dist: 0, maxDist: 200, ttl: 5, chainId: "tier1", speed: 0 }];
  const origKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  try {
    tickWorld(world, 0.066, send);
    assert.ok(!lastOf(sent, "combatStart"), "no PvE combat starts on top of the duel");
    assert.ok(!rp.inCombat, "player is not pulled into a second fight");
    assert.ok(round.monsters.some((m) => m.id === "mobX"), "the wild monster stays on the map (not consumed by a skipped engage)");
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
  }
});

test("TQ-180: return-gated throw cooldown — only one in-flight chain per player at a time", async () => {
  const { world, conn, send, round } = await activeRound();
  const id = conn.playerId;
  round.monsters = [];
  const mine = () => round.projectiles.filter((pr) => pr.owner === id).length;
  handleMessage(world, conn, { t: "input", type: "throw", payload: { dx: 1, dy: 0, chainId: "tier1" } }, send);
  tickWorld(world, 0.066, send);
  assert.equal(mine(), 1, "first throw spawned one in-flight chain");
  handleMessage(world, conn, { t: "input", type: "throw", payload: { dx: 1, dy: 0, chainId: "tier1" } }, send);
  tickWorld(world, 0.066, send);
  assert.equal(mine(), 1, "a second throw is blocked while the previous chain is still in flight");
  for (let i = 0; i < 200 && round.projectiles.length; i++) tickWorld(world, 0.066, send);
  assert.equal(round.projectiles.length, 0, "the in-flight chain eventually returns/despawns");
  handleMessage(world, conn, { t: "input", type: "throw", payload: { dx: 1, dy: 0, chainId: "tier1" } }, send);
  tickWorld(world, 0.066, send);
  assert.equal(mine(), 1, "throw re-enabled after the chain returned");
});

test("TQ-450: a charged throw scales projectile range + speed; a tap (charge 0) = the base throw", async () => {
  const { world, conn, send, round } = await activeRound();
  const id = conn.playerId;
  round.monsters = [];
  const sample = (charge) => {
    round.projectiles = [];
    handleMessage(world, conn, { t: "input", type: "throw", payload: { dx: 1, dy: 0, chainId: "tier1", charge } }, send);
    tickWorld(world, 0.001, send);
    const pr = round.projectiles.find((p) => p.owner === id);
    return pr ? { maxDist: pr.maxDist, speed: pr.speed } : null;
  };
  const base = sample(0), full = sample(1);
  assert.ok(base && full, "both throws spawned a projectile");
  const SC = GAME.SPIRIT_CHAIN;
  assert.ok(Math.abs(full.maxDist - base.maxDist * (1 + SC.CHARGE_RANGE_BONUS)) < 0.5, "full charge scales range by CHARGE_RANGE_BONUS");
  assert.ok(Math.abs(full.speed - base.speed * (1 + SC.CHARGE_SPEED_BONUS)) < 0.5, "full charge scales speed by CHARGE_SPEED_BONUS");
  assert.ok(full.maxDist > base.maxDist && full.speed > base.speed, "a charged throw flies farther AND faster than a tap");
  const half = sample(0.5);
  assert.ok(half.maxDist > base.maxDist && half.maxDist < full.maxDist, "partial charge → partial range");
});

test("spirit chain: a thrown chain that misses boomerangs back to the tamer (free throw)", async () => {
  const { world, conn, send, round } = await activeRound();
  const id = conn.playerId;
  const rp = round.players.get(id);
  const prof = world.sessions.get(id).profile;
  const startThrows = prof.chains[0].throwCount;
  round.monsters = [];
  {
    const E = GAME.EFFECTIVE_TILE, N = round.mapSize;
    const walk = (tx, ty) => !!round.map.voidMap[tx]?.[ty] && !round.map.tileMap?.[tx]?.[ty]?.collidable;
    let done = false;
    for (let tx = Math.floor(N / 2); tx >= 2 && !done; tx--) {
      for (let ty = 2; ty < N - 2 && !done; ty++) {
        if (walk(tx, ty) && walk(tx + 1, ty) && walk(tx + 2, ty) && walk(tx + 3, ty)) {
          rp.x = tx * E + E / 2; rp.y = ty * E + E / 2; done = true;
        }
      }
    }
  }
  handleMessage(world, conn, { t: "input", type: "throw", payload: { dx: 1, dy: 0, chainId: "tier1" } }, send);
  let lastLive = null;
  for (let i = 0; i < 80; i++) {
    tickWorld(world, 0.066, send);
    const pr = round.projectiles[0];
    if (pr) lastLive = { x: pr.x, y: pr.y, returning: !!pr.returning };
    if (lastLive && round.projectiles.length === 0) break;
  }
  assert.equal(round.projectiles.length, 0, "the chain despawned within its ttl (didn't live forever)");
  const backDist = Math.hypot(lastLive.x - rp.x, lastLive.y - rp.y);
  assert.ok(lastLive.returning || backDist <= 90, "the chain was heading back to the tamer when it despawned (boomerang)");
  assert.equal(prof.chains[0].throwCount, startThrows, "no throw was consumed (free overworld throw)");
});

test("setChainSlots: validates ownership, dedupes, caps the 3-slot loadout", async () => {
  const { world, conn, send } = await activeRound();
  const prof = world.sessions.get(conn.playerId).profile;
  handleMessage(world, conn, { t: "setChainSlots", chainIds: ["tier3", "tier3", "__hack__", "tier1", "tier2"] }, send);
  assert.deepEqual(prof.equippedChainIds, ["tier3", "tier1", "tier2"], "owned + deduped, capped at CHAIN_SLOTS");
  assert.ok(prof.equippedChainIds.includes(prof.equippedChainId), "the active chain stays inside the loadout");
});

test("GP-15: a move queued during combat is dropped — no lurch when combat ends", async () => {
  const { world, conn, send, round } = await activeRound();
  const rp = round.players.get(conn.playerId);
  rp.inCombat = "c_fake";
  rp.pendingMove = { dx: 1, dy: 0 };
  tickWorld(world, 0.066, send);
  assert.equal(rp.pendingMove, null, "queued move cleared while locked in combat");
  rp.inCombat = null;
  const x0 = rp.x;
  tickWorld(world, 0.066, send);
  assert.equal(rp.x, x0, "no stale-move lurch on the first post-combat tick");
});

test("spawn protection: no wild monster within 4 tiles of a spawn, and a 3s grace before any encounter", async () => {
  const origKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test";
  try {
    const { world, conn, send, round } = await activeRound();
    const rp = round.players.get(conn.playerId);
    const E = GAME.EFFECTIVE_TILE;
    assert.ok(round.monsters.every((mo) => Math.hypot(mo.x - rp.x, mo.y - rp.y) > 4 * E), "no monster left within 4 tiles of the spawn");
    assert.ok(rp.encounterGraceUntil > Date.now(), "spawn grace is armed");
    round.monsters.push({ id: "mo_spawn", typeName: getMonsterTypes()[0].typeName, level: 1, x: rp.x, y: rp.y, hidden: false });
    tickWorld(world, 0.066, send);
    assert.ok(!rp.inCombat, "no fight on the first ticks after spawning");
  } finally { if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey; }
});

test("leaveRun: forfeits a normal round through the normal terminal (died, reason left, synced profile); the client is not disconnected", async () => {
  const { world, conn, send, round, sent } = await activeRound();
  const prof = world.sessions.get(conn.playerId).profile;
  prof.gold = 777;
  handleMessage(world, conn, { t: "leaveRun" }, send);
  const died = lastOf(sent, "died");
  assert.ok(died, "a died terminal is sent");
  assert.equal(died.reason, "left");
  assert.ok(died.profile && died.profile.gold === 777 && Array.isArray(died.profile.chains), "the terminal carries the synced profile");
  assert.equal(world.sessions.get(conn.playerId).state, "idle", "session back to idle (still connected)");
  assert.ok(!round.players.has(conn.playerId), "removed from the round");
});

test("death loses the monsters caught THIS run that went to the vault; the pre-run vault is kept and refills the team", async () => {
  const { world, conn, send, sent } = await activeRound();
  const s = world.sessions.get(conn.playerId);
  const TN = getMonsterTypes()[0].typeName;
  const mk = (id) => ({ id, typeName: TN, name: TN, level: 3, xp: 0, currentHealth: 10, currentEnergy: 10, status: null });
  s.profile.vaultMonsters = [mk("pre_run_vault")];
  s.runVaultIds = ["pre_run_vault"];
  s.profile.vaultMonsters.push(mk("caught_this_run"));
  handleMessage(world, conn, { t: "leaveRun" }, send);
  const died = lastOf(sent, "died");
  assert.ok(died, "a died terminal is sent");
  assert.equal(died.lostCatches, 1, "the terminal reports one lost catch");
  const all = [...(s.profile.activeMonsters || []), ...(s.profile.vaultMonsters || [])].map((m) => m.id);
  assert.ok(!all.includes("caught_this_run"), "the run's catch is gone from team and vault");
  assert.ok(all.includes("pre_run_vault"), "the pre-run vault monster survives (it refills the lost team)");
});

test("death loses the items looted this run; items brought into the run are kept", async () => {
  const { world, conn, send, sent } = await activeRound();
  const s = world.sessions.get(conn.playerId);
  s.profile.items = [{ id: "brought_in", name: "Tonic" }];
  s.runItemIds = ["brought_in"];
  s.profile.items.push({ id: "looted_here", name: "Ember" });
  handleMessage(world, conn, { t: "leaveRun" }, send);
  const died = lastOf(sent, "died");
  assert.equal(died.lostItems, 1);
  assert.deepEqual(s.profile.items.map((i) => i.id), ["brought_in"]);
});

test("runAtRisk counts this run's catches and newly looted items", async () => {
  const { world, conn } = await activeRound();
  const s = world.sessions.get(conn.playerId);
  assert.deepEqual(runAtRisk(s), { catches: 0, items: 0 }, "a fresh run has nothing at risk");
  s.profile.items = [...(s.profile.items || []), { id: "found_here", name: "Ember" }];
  s.runCatchCount = 2;
  assert.deepEqual(runAtRisk(s), { catches: 2, items: 1 });
});

test("post-fight grace: a wild monster standing on the player does not re-engage for ~3s after a fight ends (a thrown chain still can)", async () => {
  const origKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test";
  try {
    const { world, conn, send, round } = await activeRound();
    const rp = round.players.get(conn.playerId);
    round.monsters = [{ id: "mo_grace", typeName: getMonsterTypes()[0].typeName, level: 1, x: rp.x, y: rp.y, hidden: false }];
    rp.encounterGraceUntil = Date.now() + 3000;
    tickWorld(world, 0.066, send);
    assert.ok(!rp.inCombat, "no auto-encounter during the grace window");
    rp.encounterGraceUntil = Date.now() - 1;
    tickWorld(world, 0.066, send);
    assert.ok(rp.inCombat, "the same monster engages once the grace is over");
  } finally { if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey; }
});

test("anti-cheat (SEC-A2): a player can't throw a chain they don't own", async () => {
  const { world, conn, send, round } = await activeRound();
  const rp = round.players.get(conn.playerId);
  const prof = world.sessions.get(conn.playerId).profile;
  assert.ok(!(prof.chains || []).some((c) => c.chainId === "guaranteed"), "precondition: doesn't own it");
  handleMessage(world, conn, { t: "input", type: "throw", payload: { dx: 1, dy: 0, chainId: "guaranteed" } }, send);
  tickWorld(world, 0.066, send);
  assert.equal(round.projectiles.length, 0, "no projectile launched for an unowned chain");
  assert.ok(!rp.inCombat, "no combat engaged from a forged chain throw");
});

test("spirit chain: opening a loot chest grants its loot (run-found) and removes the chest", async () => {
  const { world, conn, send, round, sent } = await activeRound();
  const id = conn.playerId;
  const rp = round.players.get(id);
  const prof = world.sessions.get(id).profile;

  round.chests = [{ id: "chX", x: rp.x, y: rp.y, loot: ["endless"] }];
  assert.ok(!prof.chains.some((c) => c.chainId === "endless"), "doesn't own endless yet");
  tickWorld(world, 0.066, send);
  const got = prof.chains.find((c) => c.chainId === "endless");
  assert.ok(got, "endless granted from the chest");
  assert.equal(got.runFound, true, "chest loot is provisional (run-found)");
  assert.equal(round.chests.length, 0, "chest consumed");

  tickWorld(world, 0.066, send);
  const snap = sent.filter((m) => m.t === "snapshot" && m.you?.id === id && m.youMeta).pop();
  assert.ok(snap && snap.youMeta.chains.some((c) => c.chainId === "endless"), "snapshot carries the new chain");
});

test("sprint: holding shift drains stamina while moving; releasing regenerates it", async () => {
  const { world, conn, send, round } = await activeRound();
  const rp = round.players.get(conn.playerId);
  round.monsters = [];
  assert.equal(rp.stamina, GAME.SPRINT.STAMINA_MAX, "spawns with full stamina");

  for (let i = 0; i < 5; i++) {
    handleMessage(world, conn, { t: "input", type: "move", payload: { dx: 1, dy: 0, sprint: true } }, send);
    tickWorld(world, 0.1, send);
  }
  assert.ok(rp.stamina < GAME.SPRINT.STAMINA_MAX, "sprinting drained stamina");
  const drained = rp.stamina;

  tickWorld(world, 0.5, send);
  assert.ok(rp.stamina > drained, "stamina regenerates while not sprinting");

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
  const A = { id: "A", typeName: t.typeName, level: 2, x: rp.x + 60, y: rp.y, hidden: false };
  const B = { id: "B", typeName: t.typeName, level: 2, x: rp.x + 60, y: rp.y + 90, hidden: false };
  const C = { id: "C", typeName: t.typeName, level: 2, x: rp.x + 60, y: rp.y + 900, hidden: false };
  round.monsters = [A, B, C];

  const origKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  try {
    handleMessage(world, conn, { t: "input", type: "throw", payload: { dx: 1, dy: 0, chainId: "multi" } }, send);
    let combatId = null;
    for (let i = 0; i < 8 && !combatId; i++) { tickWorld(world, 0.066, send); combatId = rp.inCombat; }
    assert.ok(combatId, "combat started from the multi throw");
    const session = world.combats.get(combatId);
    assert.equal(session.queue.length, 1, "one clustered monster queued (B), not the far one (C)");
    assert.equal(session.queue[0].id, "B");
    assert.ok(!round.monsters.includes(A) && !round.monsters.includes(B), "A+B left the map");
    assert.ok(round.monsters.includes(C), "the far monster stays on the map");
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
  }
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

  handleMessage(world, conn, { t: "queue" }, send);
  handleMessage(world, conn, { t: "buyUpgrade", upgradeId: "prospector" }, send);
  assert.equal(lastOf(sent, "upgrades").locked, true);
});

test("CN-9: buyCosmetic deducts the catalog price + grants ownership, server-authoritative", () => {
  const { world, conn, sent, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: "Stylist" }, send);
  const prof = world.sessions.get(conn.playerId).profile;
  prof.gold = 300;
  handleMessage(world, conn, { t: "buyCosmetic", kind: "chain", skinId: "void" }, send);
  let r = lastOf(sent, "cosmetic");
  assert.ok(r && r.ok, "purchase succeeded");
  assert.equal(r.gold, 50, "250 gold deducted (price from the server catalog, not the client)");
  assert.ok(r.ownedCosmetics.chain.includes("void"), "skin granted");
  assert.equal(prof.gold, 50);

  handleMessage(world, conn, { t: "buyCosmetic", kind: "chain", skinId: "void" }, send);
  r = lastOf(sent, "cosmetic");
  assert.equal(r.ok, false);
  assert.equal(prof.gold, 50, "no further deduction when already owned");

  prof.gold = 10;
  handleMessage(world, conn, { t: "buyCosmetic", kind: "chain", skinId: "frost" }, send);
  r = lastOf(sent, "cosmetic");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "gold");
  assert.equal(prof.gold, 10);

  handleMessage(world, conn, { t: "buyCosmetic", kind: "chain", skinId: "does-not-exist" }, send);
  assert.equal(lastOf(sent, "cosmetic").ok, false);
});

test("crafting: craftChain upgrades an owned chain for gold (idle only)", () => {
  const { world, conn, sent, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: "Crafter" }, send);
  const prof = world.sessions.get(conn.playerId).profile;
  prof.gold = 500;
  handleMessage(world, conn, { t: "craftChain", chainId: "tier1" }, send);
  const r = lastOf(sent, "shop");
  assert.equal(r.ok, true);
  assert.ok(prof.chains.some((c) => c.chainId === "tier2"), "tier2 crafted");
  assert.ok(!prof.chains.some((c) => c.chainId === "tier1"), "tier1 consumed");
  assert.ok(r.gold < 500, "gold spent");

  prof.gold = 0;
  handleMessage(world, conn, { t: "craftChain", chainId: "tier2" }, send);
  assert.equal(lastOf(sent, "shop").reason, "gold");

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
  for (const m of prof.activeMonsters) m.currentHealth = 0;

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

  prof.gold = 5;
  handleMessage(world, conn, { t: "buyChain", chainId: "tier5" }, send);
  assert.equal(lastOf(sent, "shop").ok, false);
  assert.equal(prof.gold, 5);

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
  {
    const { world, conn, send, round, sent } = await activeRound({ circleStartS: 0, portalIntervalS: 1 });
    tickWorld(world, 0.066, send);
    const s = world.sessions.get(conn.playerId);
    s.profile.chains.push({ chainId: "guaranteed", throwCount: 3, durability: 3, runFound: true });
    const rp = round.players.get(conn.playerId);
    const p = round.portals[0]; rp.x = p.x; rp.y = p.y;
    tickWorld(world, 0.066, send);
    assert.ok(lastOf(sent, "extracted"), "extracted");
    const kept = s.profile.chains.find((c) => c.chainId === "guaranteed");
    assert.ok(kept && !kept.runFound, "run-found chain banked (flag cleared) on extract");
  }
  {
    const { world, conn, send, round, sent } = await activeRound();
    const s = world.sessions.get(conn.playerId);
    s.profile.chains.push({ chainId: "guaranteed", throwCount: 3, durability: 3, runFound: true });
    round.startedAtMs = Date.now() - (world.cfg.roundDurationS + 5) * 1000;
    tickWorld(world, 0.066, send);
    assert.ok(lastOf(sent, "died"), "died");
    assert.ok(!s.profile.chains.some((c) => c.chainId === "guaranteed"), "run-found chain lost on death");
    assert.ok(s.profile.chains.length >= 1, "still has a usable (banked) chain");
  }
});

test("Q10: a combat WIPE ends the run with the death penalty (can't extract a fainted team)", async () => {
  const origKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const { world, conn, send, round, sent, id } = await activeRound();
    const s = world.sessions.get(id);
    const t = getMonsterTypes()[0];
    s.profile.activeMonsters = [{ id: "m_dead", typeName: t.typeName, name: t.typeName, level: 3, currentHealth: 0, currentEnergy: 0, status: null }];
    s.profile.vaultMonsters = [{ id: "m_vault", typeName: t.typeName, name: t.typeName, level: 1, currentHealth: 30, currentEnergy: 30, status: null }];
    s.runVaultIds = ["m_vault"];
    const deaths0 = (s.profile.stats && s.profile.stats.deaths) || 0;

    const enemy = { typeName: t.typeName, name: t.typeName, level: 3, currentHealth: 200, currentEnergy: 50, status: null };
    const combatId = "c_wipe";
    world.combats.set(combatId, {
      combatId, playerId: id, roundId: round.roundId,
      team: s.profile.activeMonsters, activeIdx: 0, enemy, monsterEntry: { typeName: t.typeName, level: 3 },
      rng: { next: () => 0.5 }, initiator: "enemy", chainId: null, queue: [],
    });
    round.players.get(id).inCombat = combatId;

    handleMessage(world, conn, { t: "combatAction", combatId, action: { kind: "attack", attackName: "noop" } }, send);
    const wipeDeadline = Date.now() + 3000;
    while (!lastOf(sent, "died") && Date.now() < wipeDeadline) await sleep(5);

    assert.ok(lastOf(sent, "died"), "a combat wipe sends the 'died' terminal (run ended)");
    assert.ok(!round.players.has(id), "player is removed from the round on a combat-wipe death");
    assert.equal(s.profile.activeMonsters[0]?.id, "m_vault", "Q10: the run team is lost and refilled from the vault");
    assert.equal((s.profile.stats && s.profile.stats.deaths) || 0, deaths0 + 1, "the death is counted");
    assert.equal(world.combats.has(combatId), false, "combat session cleaned up");
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
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
  const viewA = new Map();
  const foldA = () => { for (const m of sent) if (m.t === "snapshot" && m.you?.id === a.playerId) { if (m.full) viewA.clear(); if (m.players) for (const o of m.players) viewA.set(o.id, o); if (m.pGone) for (const id of m.pGone) viewA.delete(id); } };

  rpA.x = 0; rpA.y = 0; rpB.x = 50000; rpB.y = 50000;
  sent.length = 0;
  tickWorld(world, 0.066, send); tickWorld(world, 0.066, send);
  foldA();
  assert.equal(viewA.size, 0, "far rival is hidden");

  rpB.x = rpA.x + 100; rpB.y = rpA.y;
  sent.length = 0;
  tickWorld(world, 0.066, send); tickWorld(world, 0.066, send);
  foldA();
  assert.equal(viewA.size, 1, "nearby rival is visible");
  assert.ok(viewA.has(b.playerId), "and it's the right rival");
});

test("P6-T1: disconnect keeps the player in the round during the grace window", async () => {
  const { world, conn, round } = await activeRound();
  removePlayer(world, conn.playerId);
  const s = world.sessions.get(conn.playerId);
  assert.ok(s && s.disconnected, "session kept and marked disconnected");
  assert.ok(round.players.has(conn.playerId), "round slot preserved during grace");
});

test("disconnect mid-fight returns the abandoned monster(s) to the round (no leak)", async () => {
  const { world, conn, round } = await activeRound();
  const id = conn.playerId;
  const t = getMonsterTypes()[0];
  const entry = { id: "mob_fight", typeName: t.typeName, level: 3, x: 10, y: 10, hidden: false };
  const queued = { id: "mob_queued", typeName: t.typeName, level: 2, x: 12, y: 10, hidden: false };
  round.monsters = (round.monsters || []).filter((m) => m !== entry && m !== queued);
  const before = round.monsters.length;
  world.combats.set("c_drop", {
    combatId: "c_drop", playerId: id, roundId: round.roundId,
    team: world.sessions.get(id).profile.activeMonsters, activeIdx: 0,
    enemy: { typeName: t.typeName, level: 3, currentHealth: 50, currentEnergy: 50, status: null },
    monsterEntry: entry, queue: [queued], rng: { next: () => 0.5 }, initiator: "player", chainId: null,
  });
  round.players.get(id).inCombat = "c_drop";

  removePlayer(world, id);

  assert.equal(world.combats.has("c_drop"), false, "combat session torn down");
  assert.equal(round.players.get(id)?.inCombat, null, "player no longer flagged in combat");
  assert.ok(round.monsters.includes(entry), "the engaged monster is returned to the map");
  assert.ok(round.monsters.includes(queued), "the clustered monster is returned too");
  assert.equal(round.monsters.length, before + 2, "exactly the abandoned monsters came back (no leak, no dupes)");
});

test("extracting while a fight just started returns the engaged monster (endRunForPlayer no leak)", async () => {
  const { world, conn, sent, send, round } = await activeRound();
  const id = conn.playerId;
  const rp = round.players.get(id);
  const t = getMonsterTypes()[0];
  const entry = { id: "mob_portal", typeName: t.typeName, level: 2, x: rp.x, y: rp.y, hidden: false };
  round.monsters = (round.monsters || []).filter((m) => m !== entry);
  const before = round.monsters.length;
  world.combats.set("c_ext", {
    combatId: "c_ext", playerId: id, roundId: round.roundId,
    team: world.sessions.get(id).profile.activeMonsters, activeIdx: 0,
    enemy: { typeName: t.typeName, level: 2, currentHealth: 50, currentEnergy: 50, status: null },
    monsterEntry: entry, queue: [], rng: { next: () => 0.5 }, initiator: "player", chainId: null,
  });
  rp.inCombat = "c_ext";
  round.portals = [{ x: rp.x, y: rp.y }];

  tickWorld(world, 0.066, send);

  assert.ok(lastOf(sent, "extracted"), "the player extracted");
  assert.equal(world.combats.has("c_ext"), false, "combat session torn down");
  assert.ok(round.monsters.includes(entry), "the engaged monster returned to the map (not leaked on extract)");
  assert.equal(round.monsters.length, before + 1, "exactly the abandoned monster came back (no leak)");
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

test("reconnect TAKEOVER: a token rejoin while the OLD (stale) socket still looks connected takes over (no 'already_connected' lockout)", async () => {
  const { world, conn } = await activeRound();
  const id = conn.playerId;
  const token = world.sessions.get(id).profile.token;
  let oldTerminated = false;
  world.sessions.get(id).ws.terminate = () => { oldTerminated = true; };

  const sent2 = [];
  const send2 = (ws, obj) => sent2.push(obj);
  const conn2 = { ws: { readyState: 1 }, playerId: null };
  handleMessage(world, conn2, { t: "join", token }, send2);

  assert.ok(!sent2.some((m) => m.t === "error" && m.code === "already_connected"), "no 'already_connected' reject");
  assert.equal(conn2.playerId, id, "the new socket takes over the same player");
  const s = world.sessions.get(id);
  assert.equal(s.ws, conn2.ws, "session now points at the new socket");
  assert.ok(!s.disconnected, "session live");
  assert.ok(oldTerminated, "the stale old socket was terminated");
  assert.ok(sent2.some((m) => m.t === "roundStart" && m.resumed), "resumed the round on takeover");
});

test("Q12: a run that ENDS during the grace window delivers its result on reconnect (no frozen view)", async () => {
  const { world, conn, round } = await activeRound();
  const id = conn.playerId;
  const token = world.sessions.get(id).profile.token;
  removePlayer(world, id);
  round.startedAtMs = Date.now() - (world.cfg.roundDurationS + 60) * 1000;
  tickWorld(world, 0.066, () => {});
  const s = world.sessions.get(id);
  assert.ok(s, "session still kept within the grace window");
  assert.ok(s.pendingResult, "terminal result stashed because the socket was dead");

  const sent2 = [];
  const conn2 = { ws: { readyState: 1 }, playerId: null };
  handleMessage(world, conn2, { t: "join", token }, (ws, obj) => sent2.push(obj));
  const result = sent2.find((m) => m.t === "died" || m.t === "extracted");
  assert.ok(result, "reconnect delivers the died/extracted result card");
  assert.equal(result.reason, "timeout", "the actual run-end reason is preserved");
  assert.ok(!world.sessions.get(id).pendingResult, "stash cleared after delivery (no re-fire)");
});

test("P6-T1: not reconnecting within grace counts as a death (Q12 → Q10 penalty)", async () => {
  const { world, conn, round } = await activeRound();
  const id = conn.playerId;
  const s = world.sessions.get(id);
  s.profile.vaultMonsters = [{ id: "v1", typeName: s.profile.activeMonsters[0].typeName, level: 9, currentHealth: 10 }];
  s.runVaultIds = ["v1"];
  removePlayer(world, id);
  world.sessions.get(id).disconnectedAt = Date.now() - 130000;
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
  s.runVaultIds = ["vault_marker"];
  round.startedAtMs = Date.now() - (world.cfg.roundDurationS + 5) * 1000;
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
    map: { voidMap: Array.from({ length: N }, () => new Array(N).fill(true)) },
  });
  const cx = (N / 2) * E, cy = (N / 2) * E;
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
  handleMessage(world, conn, { t: "setSkin", skinId: "x".repeat(50) }, send);
  assert.equal(prof.equippedSkinId, "ember", "over-long id rejected (keeps last valid)");
  handleMessage(world, conn, { t: "setSkin", skinId: "<script>" }, send);
  assert.equal(prof.equippedSkinId, "ember", "non-token id rejected");
});

test("setCharSkin stores a valid body-model id and rejects abuse", () => {
  const { world, conn, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: "Char" }, send);
  const prof = world.sessions.get(conn.playerId).profile;
  handleMessage(world, conn, { t: "setCharSkin", charId: "knight" }, send);
  assert.equal(prof.equippedCharId, "knight", "valid id stored");
  handleMessage(world, conn, { t: "setCharSkin", charId: "x".repeat(50) }, send);
  assert.equal(prof.equippedCharId, "knight", "over-long id rejected (keeps last valid)");
  handleMessage(world, conn, { t: "setCharSkin", charId: "<script>" }, send);
  assert.equal(prof.equippedCharId, "knight", "non-token id rejected");
});

test("combatAction from a stale cross-round combat is rejected (NC-11)", () => {
  const { world, conn, send } = newCtx();
  handleMessage(world, conn, { t: "join", nickname: "X" }, send);
  const s = world.sessions.get(conn.playerId);
  s.state = "in_round"; s.roundId = "rB";
  world.combats.set("cm1", { combatId: "cm1", playerId: conn.playerId, roundId: "rA", resolving: false });
  handleMessage(world, conn, { t: "combatAction", combatId: "cm1", action: { kind: "flee" } }, send);
  assert.equal(world.combats.get("cm1").resolving, false, "cross-round combatAction rejected (combat not resolved)");
});

test("computeRunGains: run-end deltas vs the start snapshot; clamps negatives; safe when unstarted", () => {
  assert.deepEqual(computeRunGains({}), { caught: 0, xpGained: 0, levelUps: 0, survivedS: 0 });
  assert.deepEqual(computeRunGains(null), { caught: 0, xpGained: 0, levelUps: 0, survivedS: 0 });

  const s = {
    runStart: { caught: 2, xp: 100, levels: 8, at: Date.now() - 5000 },
    profile: { stats: { caught: 5 }, activeMonsters: [{ xp: 80, level: 5 }, { xp: 70, level: 6 }] },
  };
  const g = computeRunGains(s);
  assert.equal(g.caught, 3, "5 caught now - 2 at start");
  assert.equal(g.xpGained, 50, "team xp 150 - 100 start");
  assert.equal(g.levelUps, 3, "team levels 11 - 8 start");
  assert.ok(g.survivedS >= 4 && g.survivedS <= 7, `~5s survived, got ${g.survivedS}`);

  const dropped = computeRunGains({ runStart: { caught: 9, xp: 999, levels: 99, at: Date.now() }, profile: { stats: { caught: 1 }, activeMonsters: [] } });
  assert.deepEqual({ caught: dropped.caught, xpGained: dropped.xpGained, levelUps: dropped.levelUps }, { caught: 0, xpGained: 0, levelUps: 0 });
});

test("runStartSnapshot: captures caught + team xp/level sums + a timestamp; safe on an empty profile", () => {
  const before = Date.now();
  const s = runStartSnapshot({ stats: { caught: 3 }, activeMonsters: [{ xp: 10, level: 2 }, { xp: 20, level: 3 }] });
  assert.equal(s.caught, 3);
  assert.equal(s.xp, 30, "team xp 10+20");
  assert.equal(s.levels, 5, "team levels 2+3");
  assert.ok(s.at >= before && s.at <= Date.now(), "stamped now");
  const empty = runStartSnapshot({});
  assert.deepEqual({ caught: empty.caught, xp: empty.xp, levels: empty.levels }, { caught: 0, xp: 0, levels: 0 });
});

test("runStartSnapshot + computeRunGains round-trip: a run's gains = end minus the start snapshot", () => {
  const profile = { stats: { caught: 3 }, activeMonsters: [{ xp: 10, level: 2 }, { xp: 20, level: 3 }] };
  const start = runStartSnapshot(profile);
  profile.stats.caught = 5;
  profile.activeMonsters[0].xp = 60;
  profile.activeMonsters[1].level = 4;
  const g = computeRunGains({ runStart: start, profile });
  assert.equal(g.caught, 2);
  assert.equal(g.xpGained, 50);
  assert.equal(g.levelUps, 1);
});

test("TQ-66: a chest opened with a full item bag tells the player it was left behind (no silent loss)", async () => {
  const { world, id, sent, send, round } = await activeRound({ circleStartS: 9999, roundDurationS: 600 });
  const s = world.sessions.get(id);
  const rp = round.players.get(id);
  rp.inCombat = false; rp.inPvp = false;
  round.monsters = [];
  const itemName = "Test Tonic";
  addItem({ name: itemName, description: "restores a little health" });

  s.profile.items = Array.from({ length: GAME.ITEM_BAG_SIZE - 1 }, (_, i) => ({ id: "f" + i, name: "Filler", description: "x" }));
  round.chests = [{ id: "chA", x: rp.x, y: rp.y, loot: [], item: itemName }];
  let before = sent.length;
  tickWorld(world, 0.066, send);
  assert.equal(s.profile.items.length, GAME.ITEM_BAG_SIZE, "room → the looted item is added to the bag");
  assert.ok(!sent.slice(before).some((m) => m.t === "lootNotice"), "room → no bag-full notice");

  round.chests = [{ id: "chB", x: rp.x, y: rp.y, loot: [], item: itemName }];
  before = sent.length;
  tickWorld(world, 0.066, send);
  assert.equal(s.profile.items.length, GAME.ITEM_BAG_SIZE, "full → the bag does not grow past ITEM_BAG_SIZE");
  const notice = sent.slice(before).find((m) => m.t === "lootNotice");
  assert.ok(notice, "full → the player gets a lootNotice instead of a silent loss");
  assert.ok(notice.text.includes(itemName), "the notice names the item that was left behind");
});

test("TQ-476 server delta: first snapshot is a full keyframe; a SHED snapshot doesn't advance the baseline", async () => {
  const { world, round, conn } = await activeRound();
  const id = conn.playerId;
  const rp = round.players.get(id);
  rp.x = 1500; rp.y = 1500;
  const clone = round.monsters[0] ? { ...round.monsters[0] } : { typeName: "x", level: 1, hidden: false };
  const mT = { ...clone, id: "mT", x: rp.x + 60, y: rp.y, hidden: false };
  round.monsters.push(mT);

  const cap = [];
  const sendOK = (ws, obj) => { cap.push(obj); return true; };
  const sendShed = (ws, obj) => { cap.push(obj); return obj && obj.t === "snapshot" ? false : true; };
  const snap = () => cap.filter((m) => m.t === "snapshot" && m.you && m.you.id === id).pop();
  const inView = (m) => (m && m.monsters || []).some((o) => o.id === "mT");
  const goneHas = (m) => (m && m.mGone || []).includes("mT");

  cap.length = 0; tickWorld(world, 0.066, sendOK);
  let sm = snap();
  assert.ok(sm && sm.full, "first snapshot is a full keyframe");
  assert.ok(inView(sm), "keyframe carries the in-view monster");

  round.monsters = round.monsters.filter((m) => m.id !== "mT");
  cap.length = 0; tickWorld(world, 0.066, sendShed);

  cap.length = 0; tickWorld(world, 0.066, sendOK);
  sm = snap();
  assert.ok(sm && !sm.full, "later snapshot is a delta, not a keyframe");
  assert.ok(goneHas(sm), "the moved/removed entity is re-reported after a shed (no lost update)");
});

test("TQ-479 lag-comp: rewindMonsters interpolates monster positions to (now - lag)", () => {
  const round = { monsters: [], posHist: [
    { t: 1000, mon: [{ id: "m", x: 0, y: 0 }] },
    { t: 1066, mon: [{ id: "m", x: 100, y: 0 }] },
    { t: 1132, mon: [{ id: "m", x: 200, y: 0 }] },
  ] };
  const now = 1132;
  assert.equal(rewindMonsters(round, 0, now), null, "lag 0 → live (null)");
  assert.equal(rewindMonsters(round, 999, now), null, "target older than the buffer → live (null)");
  assert.ok(Math.abs(rewindMonsters(round, 66, now).get("m").x - 100) < 0.5, "lag 66ms → the exact middle sample (x=100)");
  assert.ok(Math.abs(rewindMonsters(round, 33, now).get("m").x - 150) < 0.5, "lag 33ms → interpolated halfway (x=150)");
});

test("TQ-479 lag-comp: recordPosHistory prunes by TIME window (rate-independent), covers the 400ms lag clamp", () => {
  const round = { monsters: [{ id: "m", x: 0, y: 0 }] };
  for (let i = 0; i < 1200; i++) { round.monsters[0].x = i; recordPosHistory(round, 1000 + i); }
  const newest = round.posHist[round.posHist.length - 1];
  assert.equal(newest.mon[0].x, 1199, "newest entry holds the latest position");
  assert.ok(round.posHist[0].t <= newest.t - 400, "oldest kept sample still covers the 400ms max view-lag clamp");
  assert.ok(round.posHist.length < 1200, "old history is pruned (bounded, not unbounded growth)");
});

test("TQ-479 lag-comp: a ping carrying `lag` records the player's view-lag (clamped to 400)", async () => {
  const { world, conn } = await activeRound();
  const s = world.sessions.get(conn.playerId);
  const rp = world.rounds.get(s.roundId).players.get(conn.playerId);
  handleMessage(world, conn, { t: "ping", t0: 1, lag: 150 }, () => {});
  assert.equal(rp.viewLagMs, 150, "view-lag recorded from the ping");
  handleMessage(world, conn, { t: "ping", t0: 2, lag: 9999 }, () => {});
  assert.equal(rp.viewLagMs, 400, "absurd lag clamped to the 400ms cap");
});

test("TQ-529 adventure: no storm or timer, a travel rift is placed, stepping on it travels to region 2, returnHome keeps the team", async () => {
  loadData();
  const sent = [];
  const send = (ws, m) => sent.push(m);
  const world = createWorld({ minPlayers: 16, countdownTicks: 99999, circleStartS: 1, roundDurationS: 30 });
  const conn = { ws: { readyState: 1 }, playerId: null };
  handleMessage(world, conn, { t: "join", nickname: "Wanderer" }, send);
  handleMessage(world, conn, { t: "queueSolo", mode: "adventure" }, send);
  const round = [...world.rounds.values()][0];
  assert.equal(round.adventure, true, "round flagged as adventure");
  let deadline = Date.now() + 9000;
  while (round.phase !== "active") { if (Date.now() > deadline) throw new Error("adventure round never went active"); await sleep(20); }
  const rs1 = lastOf(sent, "roundStart");
  assert.equal(rs1.adventure, true); assert.equal(rs1.depth, 1);
  assert.equal(round.portals.length, 1, "exactly one travel rift placed at round start");
  const teamBefore = world.sessions.get(conn.playerId).profile.activeMonsters.map((m) => m.id);
  round.startedAtMs = Date.now() - 60000;
  for (let i = 0; i < 5; i++) tickWorld(world, 0.1, send);
  assert.equal(round.circle, null, "no storm circle in adventure");
  assert.equal(round.players.size, 1, "no timeout ended the run");
  assert.ok(!sent.some((m) => m.t === "died" || m.t === "extracted"), "no run end from clock/zone");
  const rp = round.players.get(conn.playerId);
  const rift = round.portals[0];
  rp.x = rift.x; rp.y = rift.y;
  const seed1 = round.seed;
  tickWorld(world, 0.033, send);
  assert.equal(round.phase, "loading", "travel started (round regenerating)");
  deadline = Date.now() + 9000;
  while (round.phase !== "active") { if (Date.now() > deadline) throw new Error("region 2 never became active"); await sleep(20); }
  const rs2 = lastOf(sent, "roundStart");
  assert.equal(rs2.depth, 2, "arrived in region 2");
  assert.equal(rs2.travelled, true);
  assert.notEqual(round.seed, seed1, "a new seed / map");
  assert.equal(round.portals.length, 1, "a new rift waits in region 2");
  assert.ok(round.monsters.length > 0 && round.monsters.every((m) => m.level >= GAME.SPAWN_LEVEL_MIN + 1), "region 2 monsters are a level tougher (depth scaling)");
  assert.equal(round.players.size, 1, "still in the round");
  assert.equal(rs2.spawn.x, round.players.get(conn.playerId).x, "roundStart spawn = the authoritative position");
  handleMessage(world, conn, { t: "returnHome" }, send);
  const term = lastOf(sent, "extracted");
  assert.ok(term && term.reason === "returned", "returned home");
  assert.deepEqual(term.team.map((m) => m.id), teamBefore, "team kept intact");
  assert.equal(world.sessions.get(conn.playerId).state, "idle");
  assert.equal(world.rounds.size, 0, "solo round torn down");
});

test("TQ-529 adventure: returnHome is ignored outside an adventure round (a normal run can't exit for free)", async () => {
  const { world, conn, sent, send, round } = await activeRound();
  assert.equal(round.adventure, false);
  const before = sent.length;
  handleMessage(world, conn, { t: "returnHome" }, send);
  assert.equal(sent.length, before, "no reply");
  assert.equal(world.sessions.get(conn.playerId).state, "in_round", "still in the run");
});
