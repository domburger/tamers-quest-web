import { test } from "node:test";
import assert from "node:assert/strict";
import { objectiveText } from "./objective.js";

test("objectiveText is contextual: explore → storm → extract → danger (PT2-T10)", () => {
  // Early run (no storm yet): the catch/loot goal.
  assert.match(objectiveText({ circleStarted: false, portalsOpen: false, outsideZone: false }), /catch monsters/i);
  // Storm started, no portals yet: get ready to extract.
  assert.match(objectiveText({ circleStarted: true, portalsOpen: false, outsideZone: false }), /storm is closing/i);
  // Portals open: extract now.
  assert.match(objectiveText({ circleStarted: true, portalsOpen: true, outsideZone: false }), /reach a glowing portal/i);
  // Outside the safe zone overrides everything — most urgent.
  assert.match(objectiveText({ circleStarted: true, portalsOpen: true, outsideZone: true }), /safe zone/i);
  // Defensive: no args → a sensible default (the early objective), no throw.
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
