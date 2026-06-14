import { test } from "node:test";
import assert from "node:assert/strict";
import { clipInset, motionState, createHtmlMonsterOverlay } from "./htmlMonsterOverlay.js";

test("clipInset: insets the overlay to the play-window rect; null → none", () => {
  // rect at (100,80)-(500,560) in an 800x640 viewport → inset(80 300 80 100)
  assert.equal(clipInset({ x: 100, y: 80, right: 500, bottom: 560 }, 800, 640), "inset(80px 300px 80px 100px)");
  assert.equal(clipInset(null, 800, 640), "none");
  // negative/out-of-bounds clamps to 0 (square fills the viewport)
  assert.equal(clipInset({ x: -5, y: -5, right: 805, bottom: 645 }, 800, 640), "inset(0px 0px 0px 0px)");
});

test("motionState: attack > move > idle", () => {
  assert.equal(motionState({ attacking: true, moving: true }), "attack");
  assert.equal(motionState({ moving: true }), "move");
  assert.equal(motionState({}), "idle");
  assert.equal(motionState(), "idle");
});

test("createHtmlMonsterOverlay: no-ops without a DOM, never throws", () => {
  const o = createHtmlMonsterOverlay({ worldToScreen: () => ({ x: 0, y: 0, scale: 1 }) });
  const type = { html: { base: "<div></div>" } };
  assert.doesNotThrow(() => o.sync([{ id: 1, typeName: "x", type, x: 10, y: 10, designSize: 64 }], { clipDesign: { x: 0, y: 0, right: 100, bottom: 100 } }));
  assert.doesNotThrow(() => o.clear());
  assert.doesNotThrow(() => o.destroy());
});
