import test from "node:test";
import assert from "node:assert/strict";
import { makeSceneManager } from "./canvasScene.js";

test("TQ-282 scene/go: setup runs on go; current()/lastGo() track the active scene", () => {
  const sm = makeSceneManager();
  const ran = [];
  sm.scene("menu", (data) => ran.push(["menu", data]));
  sm.scene("game", (data) => ran.push(["game", data]));
  assert.equal(sm.current(), null);
  assert.equal(sm.go("missing"), false, "unknown scene → no-op");
  assert.equal(sm.go("menu"), true);
  assert.equal(sm.current(), "menu");
  sm.go("game", { level: 3 });
  assert.equal(sm.current(), "game");
  assert.deepEqual(sm.lastGo(), { name: "game", data: { level: 3 } });
  assert.deepEqual(ran, [["menu", {}], ["game", { level: 3 }]], "each go runs its setup with data");
});

test("TQ-282 onSceneLeave fires when switching away (once), and the new scene starts clean", () => {
  const sm = makeSceneManager();
  const log = [];
  sm.scene("a", () => { sm.onSceneLeave(() => log.push("leaveA")); });
  sm.scene("b", () => { sm.onSceneLeave(() => log.push("leaveB")); });
  sm.go("a");
  sm.go("b");                 // leaving a → leaveA
  assert.deepEqual(log, ["leaveA"]);
  sm.stop();                  // leaving b → leaveB
  assert.deepEqual(log, ["leaveA", "leaveB"]);
  assert.equal(sm.current(), null);
});

test("TQ-282 update/draw dispatch only to the ACTIVE scene's callbacks", () => {
  const sm = makeSceneManager();
  const hits = { a: 0, b: 0, drawA: 0, drawB: 0 };
  sm.scene("a", () => { sm.onUpdate(() => hits.a++); sm.onDraw(() => hits.drawA++); });
  sm.scene("b", () => { sm.onUpdate(() => hits.b++); sm.onDraw(() => hits.drawB++); });
  sm.go("a");
  sm.update(0.016); sm.draw({});
  assert.deepEqual(hits, { a: 1, b: 0, drawA: 1, drawB: 0 });
  sm.go("b");                 // a's callbacks are dropped with the scene
  sm.update(0.016); sm.draw({});
  assert.deepEqual(hits, { a: 1, b: 1, drawA: 1, drawB: 1 }, "only scene b's callbacks run after the switch");
});

test("TQ-282 onUpdate/onDraw pass dt/renderer through; cancel removes a callback", () => {
  const sm = makeSceneManager();
  let dtSeen = null, drew = 0;
  sm.scene("s", () => {
    sm.onUpdate((dt) => { dtSeen = dt; });
    const sub = sm.onDraw(() => drew++);
    sm.onSceneLeave(() => sub.cancel()); // canceling on leave is fine (idempotent)
  });
  sm.go("s");
  sm.update(0.5); sm.draw({}); sm.draw({});
  assert.equal(dtSeen, 0.5);
  assert.equal(drew, 2);
});

test("TQ-282 callbacks before any go() are safe no-ops (no active scene)", () => {
  const sm = makeSceneManager();
  assert.doesNotThrow(() => { sm.onUpdate(() => {}); sm.onDraw(() => {}); sm.update(0.016); sm.draw({}); sm.stop(); });
  assert.equal(sm.current(), null);
});

test("a throwing scene callback is swallowed (loop survives) AND recorded to globalThis.__drawErrs", () => {
  globalThis.__drawErrs = [];                 // start clean
  const sm = makeSceneManager();
  sm.scene("boom", () => {
    sm.onUpdate(() => { throw new Error("update kaboom"); });
    sm.onDraw(() => { throw new Error("draw kaboom"); });
  });
  sm.go("boom");
  // The loop must NOT throw — resilience is unchanged.
  assert.doesNotThrow(() => { sm.update(0.016); sm.draw({}); });
  const ring = globalThis.__drawErrs;
  assert.ok(ring.some((m) => m === "update:boom: update kaboom"), "update error recorded with scene + phase");
  assert.ok(ring.some((m) => m === "draw:boom: draw kaboom"), "draw error recorded with scene + phase");
  // A per-frame repeat collapses (consecutive dedupe) so the ring can't flood.
  const before = ring.length;
  sm.draw({}); sm.draw({}); sm.draw({});
  assert.equal(globalThis.__drawErrs.length, before, "consecutive duplicate draw errors are collapsed");
});

test("a throwing setup is swallowed and recorded with its scene name", () => {
  globalThis.__drawErrs = [];
  const sm = makeSceneManager();
  sm.scene("badsetup", () => { throw new Error("setup kaboom"); });
  assert.doesNotThrow(() => sm.go("badsetup"));
  assert.ok(globalThis.__drawErrs.some((m) => m === "setup:badsetup: setup kaboom"), "setup error recorded");
});
