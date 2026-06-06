import { test } from "node:test";
import assert from "node:assert/strict";
import { coerce, applyConfig, adminConfig, TUNABLES } from "./admin.js";

test("coerce clamps numbers, rounds ints, coerces bools, rejects junk", () => {
  assert.equal(coerce(TUNABLES.minPlayers, 99), 16);
  assert.equal(coerce(TUNABLES.minPlayers, 0), 1);
  assert.equal(coerce(TUNABLES.minPlayers, 3.7), 4);
  assert.equal(coerce(TUNABLES.monsterGenRate, 0.3), 0.3);
  assert.equal(coerce(TUNABLES.monsterGenRate, 5), 1);
  assert.equal(coerce(TUNABLES.pvpEnabled, "true"), true);
  assert.equal(coerce(TUNABLES.pvpEnabled, false), false);
  assert.equal(coerce(TUNABLES.minPlayers, "abc"), null);
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
