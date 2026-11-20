import { test } from "node:test";
import assert from "node:assert/strict";
import { objectiveText } from "./objective.js";

test("objectiveText is contextual: explore → storm → extract → danger (PT2-T10)", () => {
  assert.match(objectiveText({ circleStarted: false, portalsOpen: false, outsideZone: false }), /catch monsters/i);
  assert.match(objectiveText({ circleStarted: true, portalsOpen: false, outsideZone: false }), /storm is closing/i);
  assert.match(objectiveText({ circleStarted: true, portalsOpen: true, outsideZone: false }), /reach a glowing portal/i);
  assert.match(objectiveText({ circleStarted: true, portalsOpen: true, outsideZone: true }), /safe zone/i);
  assert.match(objectiveText(), /catch monsters/i);
});

test("objectiveText contains no decorative glyphs (UI guardrail)", () => {
  for (const s of [
    objectiveText({ circleStarted: false, portalsOpen: false, outsideZone: false }),
    objectiveText({ circleStarted: true, portalsOpen: false, outsideZone: false }),
    objectiveText({ circleStarted: true, portalsOpen: true, outsideZone: false }),
    objectiveText({ circleStarted: true, portalsOpen: true, outsideZone: true }),
  ]) {
    assert.ok(/^[\x20-\x7e]+$/.test(s), `ASCII-only, got: ${s}`);
  }
});
