import { test } from "node:test";
import assert from "node:assert/strict";
import { sprintingNow, tickStamina, sprintMult } from "./movement.js";
import { GAME } from "./schemas.js";

test("sprintingNow needs sprint input, movement, and stamina (with hysteresis at empty)", () => {
  assert.equal(sprintingNow({ sprint: true, moving: true, stamina: 100 }, GAME), true);
  assert.equal(sprintingNow({ sprint: false, moving: true, stamina: 100 }, GAME), false);
  assert.equal(sprintingNow({ sprint: true, moving: false, stamina: 100 }, GAME), false);
  // Empty stamina: can't start, even with input.
  assert.equal(sprintingNow({ sprint: true, moving: true, stamina: 0 }, GAME), false);
  // Below MIN_TO_START you must have been sprinting to continue (hysteresis).
  const low = GAME.SPRINT.MIN_TO_START - 1;
  assert.equal(sprintingNow({ sprint: true, moving: true, stamina: low, wasSprinting: false }, GAME), false);
  assert.equal(sprintingNow({ sprint: true, moving: true, stamina: low, wasSprinting: true }, GAME), true);
});

test("tickStamina drains while sprinting, regenerates otherwise, clamped to [0,max]", () => {
  const max = GAME.SPRINT.STAMINA_MAX;
  assert.equal(tickStamina(max, true, 1, GAME), max - GAME.SPRINT.DRAIN_PER_S);
  assert.equal(tickStamina(50, false, 1, GAME), 50 + GAME.SPRINT.REGEN_PER_S);
  assert.equal(tickStamina(1, true, 1, GAME), 0); // never below 0
  assert.equal(tickStamina(max - 1, false, 10, GAME), max); // never above max
});

test("sprintMult applies only while sprinting", () => {
  assert.equal(sprintMult(true, GAME), GAME.SPRINT.MULT);
  assert.equal(sprintMult(false, GAME), 1);
});
