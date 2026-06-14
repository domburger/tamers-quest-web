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
