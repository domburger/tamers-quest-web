// Controller input (user-requested). The polling needs a browser Gamepad API, but
// the deadzone math and the node-safe no-pad path are testable here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gamepadMove, gamepadPressed, gamepadConnected, applyDeadzone, BTN } from "./gamepad.js";

test("deadzone zeroes small stick values, passes larger ones", () => {
  assert.equal(applyDeadzone(0.1), 0);
  assert.equal(applyDeadzone(-0.2), 0);
  assert.equal(applyDeadzone(0.6), 0.6);
  assert.equal(applyDeadzone(-0.9), -0.9);
});

test("no gamepad → neutral move, no presses, not connected (node-safe)", () => {
  assert.equal(gamepadConnected(), false);
  assert.deepEqual(gamepadMove(), { x: 0, y: 0 });
  assert.equal(gamepadPressed().size, 0);
});

test("BTN map exposes the standard face/bumper indices", () => {
  assert.equal(BTN.A, 0);
  assert.equal(BTN.LB, 4);
  assert.equal(BTN.RB, 5);
});
