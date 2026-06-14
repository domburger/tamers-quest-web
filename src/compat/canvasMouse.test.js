import test from "node:test";
import assert from "node:assert/strict";
import { makeMouse, isTouchscreen } from "./canvasMouse.js";

// A mock canvas (EventTarget + style + a fixed rect) so synthetic pointer/wheel events drive makeMouse.
function mockCanvas(rect = { left: 0, top: 0, width: 1280, height: 720 }) {
  const ls = {};
  return {
    style: {},
    getBoundingClientRect: () => rect,
    addEventListener: (t, h) => { (ls[t] || (ls[t] = [])).push(h); },
    removeEventListener: (t, h) => { ls[t] = (ls[t] || []).filter((x) => x !== h); },
    fire: (t, e) => (ls[t] || []).forEach((h) => h(e)),
    count: (t) => (ls[t] || []).length,
  };
}
const ev = (clientX, clientY, pointerType = "mouse", extra = {}) => ({ clientX, clientY, pointerType, ...extra });

test("TQ-281 mousePos tracks the last pointer position in DESIGN coords", () => {
  const c = mockCanvas({ left: 0, top: 0, width: 2560, height: 1440 }); // 2x window
  const m = makeMouse(c);
  assert.deepEqual(m.mousePos(), { x: 0, y: 0 });
  c.fire("pointermove", ev(1280, 720));   // screen centre → design centre (640,360)
  assert.deepEqual(m.mousePos(), { x: 640, y: 360 }, "screen px mapped to design coords");
});

test("TQ-281 onMouse* fire only for non-touch pointers; positions are design coords", () => {
  const c = mockCanvas();
  const m = makeMouse(c);
  const press = [], move = [], release = [];
  m.onMousePress((p) => press.push(p));
  m.onMouseMove((p) => move.push(p));
  m.onMouseRelease((p) => release.push(p));
  c.fire("pointerdown", ev(100, 50, "mouse"));
  c.fire("pointerdown", ev(200, 60, "touch"));   // touch → mouse handler ignores
  c.fire("pointermove", ev(120, 55, "mouse"));
  c.fire("pointerup", ev(100, 50, "pen"));        // pen counts as mouse (not touch)
  assert.deepEqual(press, [{ x: 100, y: 50 }]);
  assert.deepEqual(move, [{ x: 120, y: 55 }]);
  assert.deepEqual(release, [{ x: 100, y: 50 }], "pen (non-touch) fires onMouseRelease");
});

test("TQ-281 onTouch* fire only for touch pointers, with an identifier", () => {
  const c = mockCanvas();
  const m = makeMouse(c);
  const starts = [];
  m.onTouchStart((p, info) => starts.push({ p, id: info.identifier }));
  c.fire("pointerdown", ev(10, 20, "mouse"));               // mouse → touch handler ignores
  c.fire("pointerdown", ev(30, 40, "touch", { pointerId: 7 }));
  assert.deepEqual(starts, [{ p: { x: 30, y: 40 }, id: 7 }]);
});

test("TQ-281 onScroll reports wheel deltas as {x,y}", () => {
  const c = mockCanvas();
  const m = makeMouse(c);
  const scrolls = [];
  m.onScroll((d) => scrolls.push(d));
  c.fire("wheel", { deltaX: 0, deltaY: 120 });
  c.fire("wheel", { deltaX: -40, deltaY: 0 });
  assert.deepEqual(scrolls, [{ x: 0, y: 120 }, { x: -40, y: 0 }]);
});

test("TQ-281 cancel + dispose detach listeners; setCursor sets the canvas cursor", () => {
  const c = mockCanvas();
  const m = makeMouse(c);
  let hits = 0;
  const sub = m.onMousePress(() => hits++);
  c.fire("pointerdown", ev(1, 1, "mouse"));
  sub.cancel();
  c.fire("pointerdown", ev(1, 1, "mouse"));
  assert.equal(hits, 1, "cancelled handler stops firing");
  m.setCursor("pointer");
  assert.equal(c.style.cursor, "pointer");
  m.setCursor(null);
  assert.equal(c.style.cursor, "default", "null → default cursor");
  m.dispose();
  assert.equal(c.count("pointermove"), 0, "dispose detaches all listeners");
});

test("TQ-281 isTouchscreen returns a boolean without throwing (no DOM)", () => {
  assert.equal(typeof isTouchscreen(), "boolean");
});
