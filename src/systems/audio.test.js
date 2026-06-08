// P8-T6 procedural audio (@visual). The synth itself needs a browser AudioContext,
// but the mute state + the no-op-when-unavailable guards are testable in node.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isMuted, setMuted, toggleMuted, sfx, getVolume, setVolume } from "./audio.js";

test("mute state toggles and reports correctly", () => {
  setMuted(false);
  assert.equal(isMuted(), false);
  assert.equal(toggleMuted(), true);
  assert.equal(isMuted(), true);
  assert.equal(toggleMuted(), false);
  assert.equal(isMuted(), false);
});

test("master volume clamps to [0,1], coerces junk, and persists in-process", () => {
  setVolume(0.5);
  assert.equal(getVolume(), 0.5);
  assert.equal(setVolume(1.7), 1, "clamps above 1");
  assert.equal(setVolume(-0.3), 0, "clamps below 0");
  assert.equal(setVolume("nope"), 1, "non-finite → full volume");
  setVolume(1);
});

test("sfx is a no-op at zero volume even when unmuted", () => {
  setMuted(false);
  setVolume(0);
  assert.doesNotThrow(() => sfx("hit")); // volume 0 → returns early like mute
  setVolume(1);
});

test("sfx is a safe no-op with no AudioContext (node) and on unknown names", () => {
  setMuted(false);
  assert.doesNotThrow(() => sfx("hit"));
  assert.doesNotThrow(() => sfx("nope-not-a-sound"));
  setMuted(true);
  assert.doesNotThrow(() => sfx("extract")); // muted → returns early
  setMuted(false);
});
