import test from "node:test";
import assert from "node:assert/strict";
import { normalizeKeyName, domKeyToken, makeKeyboard } from "./canvasKeyboard.js";

// A minimal EventTarget mock: records listeners so tests can fire synthetic key events.
function mockTarget() {
  const ls = {};
  return {
    addEventListener: (t, h) => { (ls[t] || (ls[t] = [])).push(h); },
    removeEventListener: (t, h) => { ls[t] = (ls[t] || []).filter((x) => x !== h); },
    fire: (t, e) => (ls[t] || []).forEach((h) => h(e)),
    count: (t) => (ls[t] || []).length,
  };
}
const kd = (key, extra = {}) => ({ key, repeat: false, ...extra });

test("TQ-280 normalizeKeyName: kaboom names -> canonical tokens", () => {
  assert.equal(normalizeKeyName("Up"), "up");
  assert.equal(normalizeKeyName("ESC"), "escape");
  assert.equal(normalizeKeyName("escape"), "escape");
  assert.equal(normalizeKeyName("Space"), "space");
  assert.equal(normalizeKeyName("A"), "a");
  assert.equal(normalizeKeyName("["), "[");
  assert.equal(normalizeKeyName("5"), "5");
});

test("TQ-280 domKeyToken: DOM KeyboardEvent.key -> canonical tokens (named, char, untracked)", () => {
  assert.equal(domKeyToken({ key: "ArrowLeft" }), "left");
  assert.equal(domKeyToken({ key: " " }), "space");
  assert.equal(domKeyToken({ key: "Escape" }), "escape");
  assert.equal(domKeyToken({ key: "Shift" }), "shift");
  assert.equal(domKeyToken({ key: "W" }), "w", "letters lowercase");
  assert.equal(domKeyToken({ key: "[" }), "[");
  assert.equal(domKeyToken({ key: "Control" }), null, "untracked multi-char key");
  assert.equal(domKeyToken({}), null);
});

test("TQ-280 isKeyDown tracks the held set; matches names<->DOM keys; keyup releases; blur clears", () => {
  const t = mockTarget();
  const kb = makeKeyboard(t);
  assert.equal(kb.isKeyDown("space"), false);
  t.fire("keydown", kd(" "));          // Space pressed
  t.fire("keydown", kd("ArrowRight"));
  assert.equal(kb.isKeyDown("space"), true, "kaboom name 'space' matches DOM ' '");
  assert.equal(kb.isKeyDown("right"), true);
  t.fire("keyup", kd(" "));
  assert.equal(kb.isKeyDown("space"), false, "keyup releases");
  assert.equal(kb.isKeyDown("right"), true);
  t.fire("blur", {});
  assert.equal(kb.isKeyDown("right"), false, "blur clears all held keys");
  kb.dispose();
  assert.equal(t.count("keydown"), 0, "dispose detaches listeners");
});

test("TQ-280 onKeyPress fires on the down EDGE only (auto-repeat ignored); cancel works", () => {
  const t = mockTarget();
  const kb = makeKeyboard(t);
  let presses = 0;
  const sub = kb.onKeyPress("enter", () => presses++);
  t.fire("keydown", kd("Enter"));               // edge → fire
  t.fire("keydown", kd("Enter", { repeat: true })); // auto-repeat → ignored
  t.fire("keydown", kd("Enter"));               // still held (no keyup) → ignored
  assert.equal(presses, 1, "one press per physical down edge");
  t.fire("keyup", kd("Enter"));
  t.fire("keydown", kd("Enter"));               // new edge → fire
  assert.equal(presses, 2);
  sub.cancel();
  t.fire("keyup", kd("Enter")); t.fire("keydown", kd("Enter"));
  assert.equal(presses, 2, "cancelled handler no longer fires");
});

test("TQ-280 onKeyDown is continuous (fired from update() per held key); onCharInput emits printable chars", () => {
  const t = mockTarget();
  const kb = makeKeyboard(t);
  let ticks = 0; kb.onKeyDown("w", () => ticks++);
  t.fire("keydown", kd("w"));
  kb.update(); kb.update();        // two frames held → two ticks
  assert.equal(ticks, 2);
  t.fire("keyup", kd("w"));
  kb.update();                     // released → no tick
  assert.equal(ticks, 2);
  // char input: printable single chars, modifiers suppress it
  const typed = []; kb.onCharInput((c) => typed.push(c));
  t.fire("keydown", kd("h")); t.fire("keydown", kd("i"));
  t.fire("keydown", kd("a", { ctrlKey: true }));  // Ctrl+A → not text
  t.fire("keydown", kd("Enter"));                  // not a single char
  assert.deepEqual(typed, ["h", "i"]);
});
