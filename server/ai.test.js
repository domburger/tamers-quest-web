import { test } from "node:test";
import assert from "node:assert/strict";
import { mapAiResult } from "./ai.js";

const player = { currentHealth: 100, maxHealth: 200, currentEnergy: 50, maxEnergy: 80 };
const enemy = { currentHealth: 80, maxHealth: 150, currentEnergy: 40, maxEnergy: 60 };

test("mapAiResult shapes + clamps the model output", () => {
  const raw = {
    playerMonster: { currentHealth: 90, currentEnergy: 30, status: "Burn" },
    enemyMonster: { currentHealth: -5, currentEnergy: 20, status: null },
    narrative: "Boom",
  };
  const r = mapAiResult(raw, player, enemy);
  assert.equal(r.player.currentHealth, 90);
  assert.equal(r.player.currentEnergy, 30);
  assert.equal(r.player.status, "Burn");
  assert.equal(r.enemy.currentHealth, 0); // clamped from -5
  assert.equal(r.narrative, "Boom");
});

test("mapAiResult clamps over-max and tolerates bad values", () => {
  const raw = {
    playerMonster: { currentHealth: 9999, currentEnergy: "x" },
    enemyMonster: { currentHealth: 75 },
    narrative: "",
  };
  const r = mapAiResult(raw, player, enemy);
  assert.equal(r.player.currentHealth, 200); // clamped to max
  assert.equal(r.player.currentEnergy, 50); // NaN → fallback to current
  assert.equal(r.enemy.currentHealth, 75);
  assert.ok(r.narrative.length > 0); // fallback narrative
});
