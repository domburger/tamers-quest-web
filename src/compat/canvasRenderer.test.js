import test from "node:test";
import assert from "node:assert/strict";
import { toRGB, anchorOrigin, makeCanvasRenderer, drawRendererDemo } from "./canvasRenderer.js";

// Fake 2D ctx recording ops; measureText is a deterministic 6px/char stub (for drawText wrap).
function fakeCtx(ops = []) {
  return new Proxy({}, {
    get: (_t, p) => {
      if (p === "measureText") return (s) => ({ width: String(s).length * 6 });
      return (typeof p === "string" && /^(fill|stroke|begin|move|line|arc|ellipse|close|rect|fillText|setTransform|clear|save|restore)/.test(p))
        ? (...a) => ops.push([p, ...a]) : undefined;
    },
    set: () => true,
  });
}

test("TQ-274 toRGB: KColor-shaped object, [r,g,b] array, and the white default", () => {
  assert.deepEqual(toRGB({ r: 10, g: 20, b: 30 }), [10, 20, 30], "duck-typed KColor");
  assert.deepEqual(toRGB([1, 2, 3]), [1, 2, 3], "array passthrough");
  assert.deepEqual(toRGB(undefined), [255, 255, 255], "default white");
  assert.deepEqual(toRGB("nope"), [255, 255, 255], "non-color → white");
});

test("TQ-274 anchorOrigin: mirrors the shim ANCHORS table (default topleft)", () => {
  assert.deepEqual(anchorOrigin("topleft"), [0, 0]);
  assert.deepEqual(anchorOrigin("center"), [0.5, 0.5]);
  assert.deepEqual(anchorOrigin("topright"), [1, 0]);
  assert.deepEqual(anchorOrigin("bot"), [0.5, 1]);
  assert.deepEqual(anchorOrigin("bottomright"), [1, 1]);
  assert.deepEqual(anchorOrigin("garbage"), [0, 0], "unknown → topleft");
});

test("TQ-274 drawRect: anchor offsets the top-left + converts KColor; outline + fill-toggle pass through", () => {
  // center anchor on a 100×40 rect at (200,100) → top-left (150,80)
  const ops = [];
  makeCanvasRenderer(fakeCtx(ops)).drawRect({ pos: { x: 200, y: 100 }, width: 100, height: 40, anchor: "center", color: { r: 1, g: 2, b: 3 } });
  const fr = ops.find(([op]) => op === "fillRect");
  assert.ok(fr, "fills the rect");
  assert.deepEqual(fr.slice(1, 5), [150, 80, 100, 40], "anchor offsets to top-left (150,80)");
  // outline-only (fill:false) → strokeRect, no fillRect
  const ring = [];
  makeCanvasRenderer(fakeCtx(ring)).drawRect({ pos: { x: 0, y: 0 }, width: 10, height: 10, fill: false, outline: { width: 2, color: [9, 9, 9] } });
  assert.ok(ring.some(([op]) => op === "strokeRect") && !ring.some(([op]) => op === "fillRect"), "fill:false → stroke only");
});

test("TQ-274 drawCircle/drawEllipse/drawLine/drawText/drawPolygon route to the right ctx ops", () => {
  const ops = [];
  const r = makeCanvasRenderer(fakeCtx(ops));
  r.drawCircle({ pos: { x: 5, y: 6 }, radius: 4, color: { r: 1, g: 2, b: 3 } });
  r.drawEllipse({ pos: { x: 7, y: 8 }, radiusX: 9, radiusY: 3, color: [1, 2, 3] });
  r.drawLine({ p1: { x: 0, y: 0 }, p2: { x: 4, y: 4 }, width: 2, color: [1, 2, 3] });
  r.drawText({ pos: { x: 1, y: 2 }, text: "hi", size: 12, color: [1, 2, 3] });
  r.drawPolygon({ pts: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 3 }], color: [1, 2, 3] });
  const e = ops.find(([op]) => op === "ellipse");
  assert.ok(ops.some(([op]) => op === "arc"), "circle → arc");
  assert.deepEqual(e.slice(1, 5), [7, 8, 9, 3], "ellipse → x,y + radii");
  assert.ok(ops.some(([op]) => op === "stroke"), "line → stroke");
  assert.ok(ops.some(([op]) => op === "fillText"), "text → fillText");
  assert.ok(ops.filter(([op]) => op === "lineTo").length >= 2, "polygon traces a path");
});

test("TQ-274 drawText: o.width word-wraps into multiple lines through the adapter", () => {
  const ops = [];
  makeCanvasRenderer(fakeCtx(ops)).drawText({ pos: { x: 0, y: 0 }, text: "the quick brown fox", size: 12, color: [1, 2, 3], width: 60 }); // 60px=10 chars
  assert.equal(ops.filter(([op]) => op === "fillText").length, 2, "wraps to 2 lines via cDrawText width");
});

test("TQ-274 drawSprite is a safe no-op (Phase 5) — never throws", () => {
  assert.doesNotThrow(() => makeCanvasRenderer(fakeCtx()).drawSprite({ sprite: "monster_x", pos: { x: 0, y: 0 } }));
});

test("TQ-275 rgb/vec2: the constructors theme.js helpers use; rgb round-trips through toRGB", () => {
  const r = makeCanvasRenderer(fakeCtx());
  // k.rgb(...[r,g,b]) — the `col = (t) => k.rgb(...t)` pattern in theme.js
  assert.deepEqual(r.rgb(10, 20, 30), { r: 10, g: 20, b: 30 });
  assert.deepEqual(toRGB(r.rgb(10, 20, 30)), [10, 20, 30], "rgb output is consumable by toRGB");
  // lone array / lone KColor pass through
  assert.deepEqual(r.rgb([1, 2, 3]), { r: 1, g: 2, b: 3 });
  assert.deepEqual(r.rgb({ r: 4, g: 5, b: 6 }), { r: 4, g: 5, b: 6 });
  assert.deepEqual(r.vec2(7, 8), { x: 7, y: 8 });
  assert.deepEqual(r.vec2(), { x: 0, y: 0 });
  // a real production-shaped call: drawRect with k.rgb color + k.vec2 pos (as theme.js issues them)
  const ops = [];
  const k = makeCanvasRenderer(fakeCtx(ops));
  k.drawRect({ pos: k.vec2(5, 6), width: 10, height: 4, color: k.rgb(1, 2, 3), radius: 2 });
  assert.ok(ops.some(([op]) => op === "fill"), "rgb+vec2 sourced rect fills");
});

test("TQ-274 drawRendererDemo: a real onDraw scene renders through the adapter without throwing", () => {
  const ops = [];
  assert.doesNotThrow(() => drawRendererDemo(makeCanvasRenderer(fakeCtx(ops)), 1.5));
  // backdrop + panel + ring + circle + ellipse + line + triangle + 3 texts → a realistic op load
  assert.ok(ops.filter(([op]) => op === "fill" || op === "fillRect" || op === "fillText" || op === "stroke").length >= 9,
    "the reference scene issues every primitive through the adapter");
});
