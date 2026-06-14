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
