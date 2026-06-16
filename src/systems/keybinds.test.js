import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BINDINGS, ACTIONS, ACTION_META, getBindings, keysFor, setBinding,
  resetBinding, resetAllBindings, loadOverrides, isActionDown, onAction, actionsForKey, normalizeKey,
} from "./keybinds.js";

// A minimal localStorage stand-in (TQ-458 — the module takes an injectable store).
function memStore(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

test("defaults reproduce the pre-TQ-458 keys (movement + core actions)", () => {
  assert.deepEqual(DEFAULT_BINDINGS.moveUp, ["w", "up"]);
  assert.deepEqual(DEFAULT_BINDINGS.moveLeft, ["a", "left"]);
  assert.deepEqual(DEFAULT_BINDINGS.throw, ["space"]);
  assert.deepEqual(DEFAULT_BINDINGS.catch, ["c"]);
  assert.deepEqual(DEFAULT_BINDINGS.attack1, ["1"]);
  assert.deepEqual(DEFAULT_BINDINGS.pause, ["escape"]);
  // Every labelled action exists and every action is labelled (UI ↔ bindings stay in sync).
  for (const m of ACTION_META) assert.ok(ACTIONS.includes(m.action), `${m.action} is a real action`);
  assert.equal(ACTION_META.length, ACTIONS.length, "every action has a label");
});

test("getBindings returns defaults with no overrides; keysFor reads per-action", () => {
  const s = memStore();
  assert.deepEqual(getBindings(s).moveDown, ["s", "down"]);
  assert.deepEqual(keysFor("flee", s), ["f"]);
  assert.deepEqual(keysFor("not-an-action", s), [], "unknown action → empty");
});

test("setBinding persists an override, normalizes + dedupes, and survives a reload", () => {
  const s = memStore();
  const out = setBinding("catch", ["K", "k", "B"], s); // upper-case + dup → normalized + deduped
  assert.deepEqual(out, ["k", "b"]);
  // A fresh read from the SAME store reflects the override (persistence round-trip).
  assert.deepEqual(keysFor("catch", s), ["k", "b"]);
  assert.deepEqual(loadOverrides(s).catch, ["k", "b"]);
  // Other actions are untouched.
  assert.deepEqual(keysFor("flee", s), ["f"]);
});

test("empty / reset reverts an action to its default (override dropped)", () => {
  const s = memStore();
  setBinding("flee", ["g"], s);
  assert.deepEqual(keysFor("flee", s), ["g"]);
  assert.deepEqual(setBinding("flee", [], s), ["f"], "empty keys → back to default");
  assert.equal(loadOverrides(s).flee, undefined, "override removed");
  setBinding("flee", ["g"], s);
  resetBinding("flee", s);
  assert.deepEqual(keysFor("flee", s), ["f"]);
});

test("resetAllBindings clears every override", () => {
  const s = memStore();
  setBinding("catch", ["k"], s);
  setBinding("flee", ["g"], s);
  resetAllBindings(s);
  assert.deepEqual(loadOverrides(s), {});
  assert.deepEqual(keysFor("catch", s), ["c"]);
});

test("isActionDown checks every bound key against k.isKeyDown", () => {
  const s = memStore();
  const downKeys = new Set(["up"]); // only the arrow is held
  const k = { isKeyDown: (key) => downKeys.has(key) };
  assert.equal(isActionDown(k, "moveUp", s), true, "arrow up triggers moveUp (bound to w/up)");
  assert.equal(isActionDown(k, "moveDown", s), false);
  // After remapping moveUp to only 'w', the held arrow no longer triggers it.
  setBinding("moveUp", ["w"], s);
  assert.equal(isActionDown(k, "moveUp", s), false, "remap drops the arrow binding");
});

test("onAction registers a handler for each bound key (remappable)", () => {
  const s = memStore();
  const reg = [];
  const k = { onKeyPress: (key, fn) => reg.push([key, fn]) };
  const fn = () => {};
  const n = onAction(k, "chainNext", fn, s); // default ["q","]"]
  assert.equal(n, 2);
  assert.deepEqual(reg.map((r) => r[0]).sort(), ["]", "q"]);
  assert.ok(reg.every((r) => r[1] === fn));
});

test("actionsForKey reverse-looks-up bindings (conflict detection)", () => {
  const s = memStore();
  assert.deepEqual(actionsForKey("c", s), ["catch"]);
  assert.deepEqual(actionsForKey("up", s), ["moveUp"]);
  // Bind 'c' to flee too → the key now reports both (a conflict the UI can warn on).
  setBinding("flee", ["c"], s);
  assert.deepEqual(actionsForKey("c", s).sort(), ["catch", "flee"]);
  assert.deepEqual(actionsForKey("", s), []);
});

test("normalizeKey lowercases/trims and rejects non-strings", () => {
  assert.equal(normalizeKey("  W "), "w");
  assert.equal(normalizeKey("Escape"), "escape");
  assert.equal(normalizeKey(42), "");
  assert.equal(normalizeKey(null), "");
});

test("loadOverrides ignores corrupt / unknown / empty entries", () => {
  assert.deepEqual(loadOverrides(memStore({ tq_keybinds: "not json" })), {});
  assert.deepEqual(loadOverrides(memStore({ tq_keybinds: JSON.stringify({ bogusAction: ["z"], catch: [] }) })), {},
    "unknown action dropped; empty key list dropped");
  assert.deepEqual(
    loadOverrides(memStore({ tq_keybinds: JSON.stringify({ catch: ["K", 9, "K"] }) })).catch,
    ["k"], "normalized + deduped, non-strings filtered");
  assert.deepEqual(loadOverrides(null), {}, "no store → {}");
});
