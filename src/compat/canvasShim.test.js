import test from "node:test";
import assert from "node:assert/strict";
import { makeCanvasShim } from "./canvasShim.js";

test("TQ-287 shim exposes the core k.* surface as functions", () => {
  const k = makeCanvasShim();
  const surface = [
    "rgb", "vec2", "width", "height", "center", "time", "dt", "loadSprite",
    "scene", "go", "onSceneLeave", "onUpdate", "onDraw", "add", "destroyAll",
    "isKeyDown", "onKeyPress", "onKeyDown", "onCharInput",
    "mousePos", "onMousePress", "onMouseMove", "onMouseRelease", "onScroll",
    "onTouchStart", "onTouchMove", "onTouchEnd", "isTouchscreen", "setCursor",
    "drawRect", "drawCircle", "drawEllipse", "drawLine", "drawText", "drawPolygon", "drawSprite",
    "pushClip", "popClip", "start", "stop",
  ];
  for (const m of surface) assert.equal(typeof k[m], "function", `k.${m} is a function`);
});

test("TQ-287 helpers: rgb/vec2/width/height/center", () => {
  const k = makeCanvasShim();
  assert.deepEqual(k.rgb(10, 20, 30), { r: 10, g: 20, b: 30 });
  assert.deepEqual(k.rgb([1, 2, 3]), { r: 1, g: 2, b: 3 }, "array form");
  assert.deepEqual(k.vec2(5, 6), { x: 5, y: 6 });
  assert.equal(k.width(), 1280);
  assert.equal(k.height(), 720);
  assert.deepEqual(k.center(), { x: 640, y: 360 });
});

test("TQ-287 scene/go + onDraw register against the active scene (via the scene manager)", () => {
  const k = makeCanvasShim();
  const ran = [];
  k.scene("menu", () => { ran.push("setup"); k.onDraw(() => {}); k.onUpdate(() => {}); });
  assert.equal(k._scenes.current(), null);
  k.go("menu");
  assert.equal(k._scenes.current(), "menu");
  assert.deepEqual(ran, ["setup"], "go ran the scene setup");
});

test("TQ-287 add/destroyAll proxy to the retained layer", () => {
  const k = makeCanvasShim();
  const o = k.add({ kind: "rect", x: 1, y: 2, tags: ["hud"] });
  assert.ok(o && o.kind === "rect");
  assert.equal(k._retained.count(), 1);
  k.destroyAll("hud");
  assert.equal(k._retained.count(), 0);
});

test("TQ-287 input + draw are safe no-ops before start() (no DOM, no throw)", () => {
  const k = makeCanvasShim();
  assert.equal(k.isKeyDown("space"), false);
  assert.deepEqual(k.mousePos(), { x: 0, y: 0 });
  assert.equal(typeof k.onKeyPress("a", () => {}).cancel, "function");
  assert.equal(typeof k.isTouchscreen(), "boolean");
  assert.doesNotThrow(() => { k.drawRect({ pos: { x: 0, y: 0 }, width: 1, height: 1 }); k.drawSprite({ sprite: "x" }); k.popClip(); });
});
