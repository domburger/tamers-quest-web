// P8-T6 procedural audio (@visual). The synth itself needs a browser AudioContext,
// but the mute state + the no-op-when-unavailable guards are testable in node.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isMuted, setMuted, toggleMuted, sfx } from "./audio.js";

test("mute state toggles and reports correctly", () => {
  setMuted(false);
  assert.equal(isMuted(), false);
  assert.equal(toggleMuted(), true);
  assert.equal(isMuted(), true);
  assert.equal(toggleMuted(), false);
  assert.equal(isMuted(), false);
});

test("sfx is a safe no-op with no AudioContext (node) and on unknown names", () => {
  setMuted(false);
  assert.doesNotThrow(() => sfx("hit"));
  assert.doesNotThrow(() => sfx("nope-not-a-sound"));
  setMuted(true);
  assert.doesNotThrow(() => sfx("extract")); // muted → returns early
  setMuted(false);
});
