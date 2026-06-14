import { test } from "node:test";
import assert from "node:assert/strict";
import { worldToScreenPx } from "./screenMap.js";

// A representative state: design W=1280, renderScale S=2 → buffer 2560; canvas FIT-displayed at 640 CSS
// px wide (cssPerBuffer = 640/2560 = 0.25; scale = S*0.25 = 0.5 CSS px per design unit), offset 30px on
// the page. Camera scrolled 200 buffer px right / 100 down.
const STATE = { renderScale: 2, bufferW: 2560, displayW: 640, boundsLeft: 30, boundsTop: 10, scrollX: 200, scrollY: 100 };

test("fixed point ignores camera scroll; design→page CSS px", () => {
  const o = worldToScreenPx({ x: 0, y: 0, fixed: true, ...STATE });
  assert.equal(o.x, 30); // boundsLeft + 0
  assert.equal(o.y, 10); // boundsTop + 0
  assert.equal(o.scale, 0.5); // 2 * (640/2560)
  // a design point at x=1280 maps to the right edge: 30 + (1280*2)*0.25 = 30 + 640
  const r = worldToScreenPx({ x: 1280, y: 0, fixed: true, ...STATE });
  assert.equal(r.x, 670);
});

test("world point subtracts the camera scroll (buffer px) before the FIT scale", () => {
  const o = worldToScreenPx({ x: 0, y: 0, fixed: false, ...STATE });
  // bufX = 0*2 - 200 = -200 → css = 30 + (-200)*0.25 = 30 - 50 = -20
  assert.equal(o.x, -20);
  assert.equal(o.y, 10 + (-100) * 0.25); // -15
  // a world point whose buffer-x equals the scroll lands at the canvas origin
  const at = worldToScreenPx({ x: 100, y: 50, fixed: false, ...STATE }); // bufX = 200-200=0, bufY=100-100=0
  assert.equal(at.x, 30);
  assert.equal(at.y, 10);
});

test("degenerate buffer width → identity-ish scale, no NaN", () => {
  const o = worldToScreenPx({ x: 10, y: 10, renderScale: 1, bufferW: 0, displayW: 100 });
  assert.ok(Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(o.scale));
});
