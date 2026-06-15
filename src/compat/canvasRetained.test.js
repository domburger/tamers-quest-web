import test from "node:test";
import assert from "node:assert/strict";
import { CanvasObj, makeRetainedLayer } from "./canvasRetained.js";

// A fake renderer (the TQ-274 adapter surface) that records each draw call + its z-significant pos.
function fakeRenderer(calls = []) {
  const rec = (kind) => (o) => calls.push({ kind, x: o.pos.x, y: o.pos.y, text: o.text, color: o.color });
  return { drawRect: rec("rect"), drawCircle: rec("circle"), drawText: rec("text"), drawSprite: rec("sprite"), calls };
}

test("TQ-276 CanvasObj: KObj-compatible getters/setters (pos/size/color/opacity/text/hidden)", () => {
  const o = new CanvasObj({ kind: "rect", x: 1, y: 2, w: 10, h: 8, color: [1, 2, 3] });
  assert.deepEqual(o.pos, { x: 1, y: 2 });
  o.pos = { x: 5, y: 6 }; assert.deepEqual(o.pos, { x: 5, y: 6 });
  o.width = 20; o.height = 12; assert.equal(o.w, 20); assert.equal(o.h, 12);
  o.color = [9, 9, 9]; assert.deepEqual(o.color, [9, 9, 9]);
  o.color = { r: 4, g: 5, b: 6 }; assert.deepEqual(o.color, [4, 5, 6], "KColor-shaped converts via toRGB");
  o.opacity = 0.5; assert.equal(o.opacity, 0.5);
  o.text = 42; assert.equal(o.text, "42", "text coerces to string");
  assert.equal(o.hidden, false); o.hidden = true; assert.equal(o.hidden, true);
});

test("TQ-276 layer: add returns a CanvasObj; remove + destroyAll(tag) prune", () => {
  const L = makeRetainedLayer();
  const a = L.add({ kind: "rect", tags: ["menu"] });
  const b = L.add({ kind: "circle", tags: ["menu", "btn"] });
  const c = L.add({ kind: "text", tags: ["hud"] });
  assert.ok(a instanceof CanvasObj);
  assert.equal(L.count(), 3);
  L.destroyAll("menu");                 // removes a + b, keeps c
  assert.equal(L.count(), 1);
  assert.deepEqual(L.objects().map((o) => o.kind), ["text"]);
  assert.equal(a._dead, true, "destroyed objects are marked dead");
  L.remove(c); assert.equal(L.count(), 0);
  // destroyAll() with no tag clears everything
  L.add({}); L.add({}); L.destroyAll(); assert.equal(L.count(), 0);
});

test("TQ-276 render: draws visible objects in stable z-order, skips hidden/dead, routes by kind", () => {
  const L = makeRetainedLayer();
  L.add({ kind: "rect", x: 10, z: 5 });            // higher z → drawn last
  L.add({ kind: "circle", x: 20, z: 1 });          // lowest z → drawn first
  L.add({ kind: "text", x: 30, z: 1, text: "hi" }); // same z as circle → insertion order after it
  const hidden = L.add({ kind: "rect", x: 99, z: 0 }); hidden.hidden = true; // skipped
  const r = fakeRenderer();
  L.render(r);
  // z-order: circle(z1) → text(z1, later insert) → rect(z5); hidden rect omitted
  assert.deepEqual(r.calls.map((c) => c.kind), ["circle", "text", "rect"]);
  assert.deepEqual(r.calls.map((c) => c.x), [20, 30, 10]);
  assert.ok(!r.calls.some((c) => c.x === 99), "hidden object not drawn");
});

test("TQ-277 contains: anchor-aware point-in-rect + point-in-circle", () => {
  // topleft rect 100×40 at (10,20): box [10..110]×[20..60]
  const r = new CanvasObj({ kind: "rect", x: 10, y: 20, w: 100, h: 40 });
  assert.ok(r.contains(60, 40) && r.contains(10, 20) && r.contains(110, 60));
  assert.ok(!r.contains(9, 40) && !r.contains(60, 61));
  // center-anchored rect 100×40 at (200,100): box [150..250]×[80..120]
  const c = new CanvasObj({ kind: "rect", x: 200, y: 100, w: 100, h: 40, anchor: "center" });
  assert.ok(c.contains(200, 100) && c.contains(150, 80) && c.contains(250, 120));
  assert.ok(!c.contains(149, 100));
  // circle radius 30 at (50,50)
  const circ = new CanvasObj({ kind: "circle", x: 50, y: 50, radius: 30 });
  assert.ok(circ.contains(50, 50) && circ.contains(79, 50));
  assert.ok(!circ.contains(81, 50), "outside the radius");
  // zero-size rect / hidden object never hit
  assert.ok(!new CanvasObj({ kind: "rect", x: 0, y: 0 }).contains(0, 0));
  const h = new CanvasObj({ kind: "rect", x: 0, y: 0, w: 10, h: 10, hidden: true }); assert.ok(!h.contains(5, 5));
});

test("TQ-277 pointerDown: fires onClick on the TOPMOST interactive object (z, then insertion)", () => {
  const L = makeRetainedLayer();
  const fired = [];
  const lo = L.add({ kind: "rect", x: 0, y: 0, w: 100, h: 100, z: 1 }).onClick((o) => fired.push("lo"));
  const hi = L.add({ kind: "rect", x: 0, y: 0, w: 100, h: 100, z: 5 }).onClick((o) => fired.push("hi"));
  L.add({ kind: "rect", x: 0, y: 0, w: 100, h: 100, z: 9 }); // higher z but NOT interactive → ignored
  assert.equal(L.pointerDown(50, 50), hi, "topmost interactive wins");
  assert.deepEqual(fired, ["hi"], "only the topmost interactive object's onClick fires");
  assert.equal(L.pointerDown(200, 200), null, "a miss fires nothing");
  void lo;
});

test("TQ-277 pointerMove: hover enter/leave as the topmost hit changes", () => {
  const L = makeRetainedLayer();
  const log = [];
  const a = L.add({ kind: "rect", x: 0, y: 0, w: 50, h: 50 }).onHover(() => log.push("enterA")).onHoverEnd(() => log.push("leaveA"));
  const b = L.add({ kind: "rect", x: 100, y: 0, w: 50, h: 50 }).onHover(() => log.push("enterB")).onHoverEnd(() => log.push("leaveB"));
  L.pointerMove(25, 25);   // enter A
  L.pointerMove(30, 30);   // still A → no event
  L.pointerMove(120, 25);  // leave A, enter B
  L.pointerMove(300, 300); // leave B (off everything)
  assert.deepEqual(log, ["enterA", "leaveA", "enterB", "leaveB"]);
  assert.equal(L.hovered(), null);
  void a; void b;
});

test("TQ-233 pointerMove: onHoverUpdate fires on enter + every move while over (addButton hover rise)", () => {
  // Regression: CanvasObj lacked onHoverUpdate, so addButton (theme.js) threw a TypeError, breaking
  // EVERY retained-button scene (character-select/lobby/start) on the canvas backend.
  const L = makeRetainedLayer();
  const log = [];
  const o = new CanvasObj({ kind: "rect", x: 0, y: 0, w: 50, h: 50 });
  assert.equal(typeof o.onHoverUpdate, "function", "CanvasObj exposes onHoverUpdate");
  assert.equal(o.onHoverUpdate(() => {}), o, "onHoverUpdate is chainable");
  const a = L.add({ kind: "rect", x: 0, y: 0, w: 50, h: 50 })
    .onHover(() => log.push("enter"))
    .onHoverUpdate(() => log.push("update"))
    .onHoverEnd(() => log.push("end"));
  assert.ok(a.interactive, "an onHoverUpdate-only listener still counts as interactive");
  L.pointerMove(25, 25); // enter → enter + update (Phaser binds pointerover + pointermove)
  L.pointerMove(30, 30); // still over → update only
  L.pointerMove(300, 300); // leave → end
  assert.deepEqual(log, ["enter", "update", "update", "end"]);
});

test("TQ-233 render(range): z-banded passes interleave retained around the onDraw layer (Phaser parity)", () => {
  // The Phaser shim places onDraw content at depth 0.5 — above default-z(0) retained (backgrounds/cards)
  // but below z>=1 overlays. The canvas host renders retained in two bands AROUND onDraw using this range.
  const L = makeRetainedLayer();
  L.add({ kind: "rect", x: 1, z: 0 });   // background
  L.add({ kind: "rect", x: 2, z: 0.2 }); // card (still below the onDraw band)
  L.add({ kind: "rect", x: 3, z: 1 });   // overlay (above onDraw)
  const below = fakeRenderer(); L.render(below, { dx: 0, dy: 0 }, { below: 0.5 });
  assert.deepEqual(below.calls.map((c) => c.x), [1, 2], "below:0.5 → only z<0.5 (bg + card)");
  const above = fakeRenderer(); L.render(above, { dx: 0, dy: 0 }, { from: 0.5 });
  assert.deepEqual(above.calls.map((c) => c.x), [3], "from:0.5 → only z>=0.5 (overlay)");
});

test("TQ-290 render(cam): world objects shift by the camera offset; fixed objects stay", () => {
  const L = makeRetainedLayer();
  L.add({ kind: "rect", x: 100, y: 100, w: 10, h: 10, z: 1 });             // world
  L.add({ kind: "rect", x: 100, y: 100, w: 10, h: 10, z: 2, fixed: true }); // fixed / HUD
  const r = fakeRenderer();
  L.render(r, { dx: 50, dy: -20 });
  assert.deepEqual([r.calls[0].x, r.calls[0].y], [150, 80], "world object shifted by the camera offset");
  assert.deepEqual([r.calls[1].x, r.calls[1].y], [100, 100], "fixed object NOT shifted");
});

test("TQ-276 render: mutating a retained object's comps shows on the next render (no re-add)", () => {
  const L = makeRetainedLayer();
  const bar = L.add({ kind: "rect", x: 0, y: 0, w: 100, h: 10, color: [200, 60, 60] });
  bar.width = 40; bar.color = [60, 200, 60]; bar.pos = { x: 4, y: 4 }; // e.g. an HP bar shrinking
  const r = fakeRenderer();
  L.render(r);
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.calls[0].color, [60, 200, 60]);
  assert.deepEqual([r.calls[0].x, r.calls[0].y], [4, 4]);
});
