import test from "node:test";
import assert from "node:assert/strict";
import { isTextInputFocused, makeRefitter, relayoutScenes, DEFAULT_GAMEPLAY_SCENES } from "./canvasRefit.js";
import { makeSceneManager } from "./canvasScene.js";

// A mock window/visualViewport recording listeners so tests can fire synthetic resize/orientation events.
function mockWin(withVV = true) {
  const mk = () => { const ls = {}; return { addEventListener: (t, h) => (ls[t] || (ls[t] = [])).push(h), removeEventListener: (t, h) => { ls[t] = (ls[t] || []).filter((x) => x !== h); }, fire: (t) => (ls[t] || []).forEach((h) => h()), count: (t) => (ls[t] || []).length }; };
  const w = mk();
  if (withVV) w.visualViewport = mk();
  return w;
}
// A manual scheduler so the debounce is deterministic (no real timers).
function manualSched() {
  let pending = null;
  return { schedule: (fn) => { pending = fn; return 1; }, clear: () => { pending = null; }, flush: () => { const f = pending; pending = null; if (f) f(); } };
}

test("TQ-283 isTextInputFocused: true for INPUT/TEXTAREA/contentEditable, false otherwise", () => {
  assert.equal(isTextInputFocused({ tagName: "INPUT" }), true);
  assert.equal(isTextInputFocused({ tagName: "TEXTAREA" }), true);
  assert.equal(isTextInputFocused({ isContentEditable: true }), true);
  assert.equal(isTextInputFocused({ tagName: "DIV" }), false);
  assert.equal(isTextInputFocused(null), false);
});

test("TQ-283 makeRefitter: debounced, fires onRefit on resize/orientation/visualViewport", () => {
  const win = mockWin();
  const s = manualSched();
  let refits = 0;
  makeRefitter({ onRefit: () => refits++, target: win, getActiveElement: () => null, schedule: s.schedule, clear: s.clear });
  win.fire("resize");
  assert.equal(refits, 0, "debounced — not yet");
  s.flush();
  assert.equal(refits, 1, "fires after the debounce");
  win.fire("orientationchange"); s.flush();
  win.visualViewport.fire("resize"); s.flush();
  assert.equal(refits, 3, "orientationchange + visualViewport also drive it");
});

test("TQ-283 makeRefitter: mobile-keyboard guard — suppressed while a text input is focused", () => {
  const win = mockWin();
  const s = manualSched();
  let refits = 0;
  let focused = { tagName: "INPUT" }; // simulate the soft keyboard open
  makeRefitter({ onRefit: () => refits++, target: win, getActiveElement: () => focused, schedule: s.schedule, clear: s.clear });
  win.fire("resize"); s.flush();
  assert.equal(refits, 0, "no relayout while typing (keyboard shrinks innerHeight)");
  focused = null;                    // field blurs / keyboard dismissed
  win.fire("resize"); s.flush();
  assert.equal(refits, 1, "re-fits once the input is no longer focused");
});

test("TQ-283 makeRefitter: dispose detaches all listeners + cancels a pending refit", () => {
  const win = mockWin();
  const s = manualSched();
  let refits = 0;
  const r = makeRefitter({ onRefit: () => refits++, target: win, getActiveElement: () => null, schedule: s.schedule, clear: s.clear });
  win.fire("resize"); // schedules
  r.dispose();
  s.flush();          // nothing pending after dispose
  assert.equal(refits, 0);
  assert.equal(win.count("resize"), 0, "listeners detached");
  assert.equal(win.visualViewport.count("resize"), 0);
});

test("TQ-283 relayoutScenes: re-runs lastGo() for a menu scene; leaves gameplay scenes running", () => {
  const sm = makeSceneManager();
  const runs = [];
  sm.scene("menu", () => runs.push("menu"));
  sm.scene("onlineGame", () => runs.push("game"));
  sm.go("menu");
  assert.equal(relayoutScenes(sm), true, "menu relayed out");
  assert.deepEqual(runs, ["menu", "menu"], "menu setup re-ran");
  sm.go("onlineGame");
  assert.equal(relayoutScenes(sm), false, "gameplay scene NOT restarted");
  assert.deepEqual(runs, ["menu", "menu", "game"], "no extra game run");
  assert.ok(DEFAULT_GAMEPLAY_SCENES.has("fight"));
});

test("makeRefitter: fullscreenchange (+ webkit) drives the refit (F11 / Fullscreen API)", () => {
  const win = mockWin();
  const s = manualSched();
  let refits = 0;
  makeRefitter({ onRefit: () => refits++, target: win, getActiveElement: () => null, schedule: s.schedule, clear: s.clear });
  win.fire("fullscreenchange"); s.flush();
  win.fire("webkitfullscreenchange"); s.flush();
  assert.equal(refits, 2, "both fullscreen events relayout the UI");
});
