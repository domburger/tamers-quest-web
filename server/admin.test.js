import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { setGameData, getMonsterTypes, getItems } from "../src/engine/gamedata.js";
import { coerce, applyConfig, adminConfig, adminStats, handleAdmin, TUNABLES } from "./admin.js";

const mockRes = () => ({ code: 0, body: "", writeHead(c) { this.code = c; }, end(s) { this.body = s || ""; } });
const mockReq = (url, method = "GET", headers = {}) => ({ url, method, headers });
// A stream-capable request so handleAdmin's readBody() can parse a POST body.
const postReq = (url, body, headers = {}) => Object.assign(Readable.from([JSON.stringify(body)]), { url, method: "POST", headers });
const fullWorld = () => ({ cfg: { minPlayers: 1, roundDurationS: 600, circleStartS: 300, portalIntervalS: 30, monsterGenRate: 0, pvpEnabled: false, baseSpeed: 200, stormDps: 25, encounterRadius: 44, hiddenMonsterPct: 35, energyRestorePct: 50, pvpRadius: 40 } });

test("coerce clamps numbers, rounds ints, coerces bools, rejects junk", () => {
  assert.equal(coerce(TUNABLES.minPlayers, 99), 16);
  assert.equal(coerce(TUNABLES.minPlayers, 0), 1);
  assert.equal(coerce(TUNABLES.minPlayers, 3.7), 4);
  assert.equal(coerce(TUNABLES.monsterGenRate, 0.3), 0.3);
  assert.equal(coerce(TUNABLES.monsterGenRate, 5), 1);
  assert.equal(coerce(TUNABLES.pvpEnabled, "true"), true);
  assert.equal(coerce(TUNABLES.pvpEnabled, false), false);
  assert.equal(coerce(TUNABLES.minPlayers, "abc"), null);
  // Monster-approach tunables are wired into the validation (were "admin-tunable" in name only).
  assert.equal(coerce(TUNABLES.monsterApproachPct, 150), 100); // clamp to max
  assert.equal(coerce(TUNABLES.monsterApproachPct, 30.6), 31); // rounds to int
  assert.equal(coerce(TUNABLES.monsterApproachSpeedFrac, 2), 1); // 0-1 fraction
  assert.equal(coerce(TUNABLES.monsterApproachRadius, 99999), 4000); // clamp to max
});

test("applyConfig writes valid fields to world.cfg and ignores the rest", () => {
  const world = { cfg: { minPlayers: 1, roundDurationS: 600, circleStartS: 300, portalIntervalS: 30, monsterGenRate: 0, pvpEnabled: false } };
  const applied = applyConfig(world, { minPlayers: 8, pvpEnabled: true, monsterGenRate: 0.2, bogus: 5, roundDurationS: "abc" });
  assert.equal(world.cfg.minPlayers, 8);
  assert.equal(world.cfg.pvpEnabled, true);
  assert.equal(world.cfg.monsterGenRate, 0.2);
  assert.equal(world.cfg.roundDurationS, 600, "invalid value ignored");
  assert.deepEqual(Object.keys(applied).sort(), ["minPlayers", "monsterGenRate", "pvpEnabled"]);
});

test("adminConfig exposes exactly the tunables", () => {
  const world = { cfg: { minPlayers: 2, roundDurationS: 600, circleStartS: 300, portalIntervalS: 30, monsterGenRate: 0.1, pvpEnabled: true, countdownTicks: 75 } };
  assert.deepEqual(Object.keys(adminConfig(world)).sort(), Object.keys(TUNABLES).sort());
});

test("adminStats summarizes live world state", () => {
  const monsterTypes = JSON.parse(readFileSync("./public/assets/data/monstertype.json", "utf8"));
  setGameData({ monsterTypes, attacks: [], groundTiles: [], items: [] });
  const world = {
    sessions: new Map([["a", {}], ["b", {}]]),
    queue: ["c"],
    rounds: new Map([["r1", { roundId: "r1", phase: "active", players: new Map([["a", {}]]), monsters: [1, 2], remaining: 120 }]]),
    combats: new Map(),
    pvps: new Map(),
    recentResults: [{ name: "X", reason: "extracted", at: 1 }],
  };
  const s = adminStats(world);
  assert.equal(s.playersOnline, 2);
  assert.equal(s.inQueue, 1);
  assert.equal(s.activeRounds, 1);
  assert.equal(s.rounds[0].players, 1);
  assert.equal(s.monsterPool, monsterTypes.length); // robust to pool growth (was hardcoded 103)
  assert.equal(s.recentResults[0].name, "X");
});

test("admin /wipe clears the live monster + item pools (authorized)", async () => {
  const orig = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = "secret-xyz";
  setGameData({
    monsterTypes: [{ typeName: "Zzz Wipe Me", element: "Fire" }],
    attacks: [], groundTiles: [],
    items: [{ id: 1, name: "Zap Potion", description: "x" }],
  });
  assert.ok(getMonsterTypes().length >= 1 && getItems().length >= 1, "pools seeded");
  const res = mockRes();
  await handleAdmin(postReq("/api/admin/wipe", { monsters: true, items: true }, { "x-admin-token": "secret-xyz" }), res, {});
  assert.equal(res.code, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.ok, true);
  assert.equal(out.pool, 0, "response reports an empty pool");
  assert.equal(getMonsterTypes().length, 0, "live monster pool cleared");
  assert.equal(getItems().length, 0, "live item pool cleared");
  if (orig === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = orig;
});

test("admin auth: 503 without ADMIN_TOKEN, 401 wrong, 200 correct (timing-safe)", async () => {
  const orig = process.env.ADMIN_TOKEN;
  delete process.env.ADMIN_TOKEN;
  let res = mockRes();
  await handleAdmin(mockReq("/api/admin/config"), res, fullWorld());
  assert.equal(res.code, 503);

  process.env.ADMIN_TOKEN = "secret-xyz";
  res = mockRes();
  await handleAdmin(mockReq("/api/admin/config", "GET", { "x-admin-token": "wrong" }), res, fullWorld());
  assert.equal(res.code, 401);

  res = mockRes();
  await handleAdmin(mockReq("/api/admin/config", "GET", { "x-admin-token": "secret-xyz" }), res, fullWorld());
  assert.equal(res.code, 200);

  if (orig === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = orig;
});

test("admin auth throttles repeated failures (429)", async () => {
  const orig = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = "secret-xyz";
  let got429 = false;
  for (let i = 0; i < 14 && !got429; i++) {
    const res = mockRes();
    await handleAdmin(mockReq("/api/admin/config", "GET", { "x-admin-token": "nope" }), res, fullWorld());
    if (res.code === 429) got429 = true;
  }
  assert.ok(got429, "locks out after repeated failed auths");
  if (orig === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = orig;
});
