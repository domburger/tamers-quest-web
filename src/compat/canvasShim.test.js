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

test("TQ-288 comp constructors return descriptors; k.add(comp list) builds a correct CanvasObj", () => {
  const k = makeCanvasShim();
  assert.equal(k.rect(100, 40, { radius: 8 }).__kcomp, "rect");
  assert.equal(k.color(10, 20, 30).color.r, 10);
  assert.deepEqual(k.color([1, 2, 3]).color, { r: 1, g: 2, b: 3 }, "array color");
  // a real button-shaped k.add(comps)
  const o = k.add([
    k.rect(200, 60, { radius: 12 }), k.pos(50, 80), k.anchor("center"),
    k.color(60, 70, 110), k.outline(2, [70, 230, 198]), k.opacity(0.9), k.z(10), "btn",
  ]);
  assert.equal(o.kind, "rect");
  assert.deepEqual([o.w, o.h, o.radius], [200, 60, 12]);
  assert.deepEqual([o.x, o.y], [50, 80]);
  assert.equal(o.anchor, "center");
  assert.deepEqual(o.color, [60, 70, 110]);
  assert.equal(o.opacity, 0.9);
  assert.equal(o.z, 10);
  assert.deepEqual(o.outline, { width: 2, color: { r: 70, g: 230, b: 198 } }, "outline color stored as {r,g,b}; renderer toRGB normalizes at draw");
  assert.ok(o.is("btn"), "string tag carried through");
});

test("TQ-288 k.add comps: text (wrap), circle, sprite kinds; flat record still passes through", () => {
  const k = makeCanvasShim();
  const t = k.add([k.text("hi there", { size: 18, width: 120 }), k.pos(10, 10), k.color(240, 243, 244)]);
  assert.equal(t.kind, "text");
  assert.equal(t.text, "hi there");
  assert.equal(t.size, 18);
  assert.equal(t.wrap, 120, "k.text width → CanvasObj.wrap");
  const c = k.add([k.circle(30), k.pos(5, 5), k.color(98, 160, 255)]);
  assert.equal(c.kind, "circle"); assert.equal(c.radius, 30);
  const s = k.add([k.sprite("hero"), k.pos(1, 1)]);
  assert.equal(s.kind, "sprite"); assert.equal(s.sprite, "hero");
  // a plain flat record (harness usage) still works
  const flat = k.add({ kind: "rect", x: 1, y: 2, w: 3, h: 4 });
  assert.equal(flat.kind, "rect"); assert.equal(flat.w, 3);
});

test("TQ-289 k.wait: fires cb after sec (frame-driven via _tickTimers); cancelable; cleared on go", () => {
  const k = makeCanvasShim();
  let fired = 0;
  k.wait(0.5, () => fired++);
  k._tickTimers(0.3); assert.equal(fired, 0, "not yet (0.3 < 0.5)");
  k._tickTimers(0.3); assert.equal(fired, 1, "fired once 0.6 >= 0.5");
  k._tickTimers(1.0); assert.equal(fired, 1, "fires only once");
  // cancel before it fires
  let fired2 = 0;
  const h = k.wait(0.5, () => fired2++);
  h.cancel();
  k._tickTimers(1.0); assert.equal(fired2, 0, "cancelled wait never fires");
  // scene switch clears pending waits
  let fired3 = 0;
  k.scene("a", () => {}); k.scene("b", () => {});
  k.go("a");
  k.wait(0.5, () => fired3++);
  k.go("b"); // clears the pending wait
  k._tickTimers(1.0); assert.equal(fired3, 0, "go() drops the old scene's pending waits");
});

test("TQ-289 k.loadFont: returns a Promise; no-op without a DOM (does not throw)", async () => {
  const k = makeCanvasShim();
  const r = k.loadFont("GameFont", "/fonts/game.woff2");
  assert.ok(r && typeof r.then === "function", "returns a thenable");
  await assert.doesNotReject(() => r); // headless (no FontFace) resolves quietly
});

test("TQ-287 input + draw are safe no-ops before start() (no DOM, no throw)", () => {
  const k = makeCanvasShim();
  assert.equal(k.isKeyDown("space"), false);
  assert.deepEqual(k.mousePos(), { x: 0, y: 0 });
  assert.equal(typeof k.onKeyPress("a", () => {}).cancel, "function");
  assert.equal(typeof k.isTouchscreen(), "boolean");
  assert.doesNotThrow(() => { k.drawRect({ pos: { x: 0, y: 0 }, width: 1, height: 1 }); k.drawSprite({ sprite: "x" }); k.popClip(); });
});
