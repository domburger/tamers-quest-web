import { test } from "node:test";
import assert from "node:assert/strict";
import { HTML_LAYER_BOX, isInPlayWindow, nodeStyle, staleKeys, createHtmlMonsterLayer } from "./htmlMonsterLayer.js";
import { pickStateHtml } from "../systems/htmlModel.js";

const RECT = { x: 100, y: 100, right: 400, bottom: 400 };

test("pickStateHtml: returns the variant when present, else falls back to base", () => {
  const m = { base: "<div>base</div>", attack: "<div>atk</div>", idle: "  " };
  assert.equal(pickStateHtml(m, "attack"), "<div>atk</div>");
  assert.equal(pickStateHtml(m, "idle"), "<div>base</div>"); // blank variant → base
  assert.equal(pickStateHtml(m, "move"), "<div>base</div>"); // missing variant → base
  assert.equal(pickStateHtml(m, "base"), "<div>base</div>");
  assert.equal(pickStateHtml(null, "base"), "");
  assert.equal(pickStateHtml({}, "base"), "");
});

test("isInPlayWindow: inside true, far outside false, null rect → no cull", () => {
  assert.ok(isInPlayWindow(250, 250, RECT));            // centre
  assert.ok(isInPlayWindow(100, 100, RECT));            // on edge
  assert.ok(isInPlayWindow(400 + HTML_LAYER_BOX, 250, RECT)); // within the pad
  assert.ok(!isInPlayWindow(400 + HTML_LAYER_BOX + 1, 250, RECT)); // just past the pad
  assert.ok(!isInPlayWindow(-1000, -1000, RECT));       // far off
  assert.ok(isInPlayWindow(99999, 99999, null));        // null rect = uncull (combat stage)
});

test("nodeStyle: scales the 256-box to size, centres it, mirrors on left-facing", () => {
  const s = nodeStyle({ sx: 250, sy: 180, size: 128, opacity: 0.5, facing: 1 });
  assert.equal(s.left, "250px");
  assert.equal(s.top, "180px");
  assert.equal(s.width, "256px");
  assert.equal(s.height, "256px");
  assert.equal(s.opacity, "0.5");
  assert.match(s.transform, /translate\(-50%, -50%\)/);
  assert.match(s.transform, /scale\(0\.5, 0\.5\)/); // 128/256
  // left-facing mirrors X only (negative X scale, same magnitude)
  const l = nodeStyle({ sx: 0, sy: 0, size: 256, facing: -1 });
  assert.match(l.transform, /scale\(-1, 1\)/);
  // defaults: opacity 1, facing right
  const d = nodeStyle({ sx: 0, sy: 0, size: 256 });
  assert.equal(d.opacity, "1");
  assert.match(d.transform, /scale\(1, 1\)/);
});

test("staleKeys: pooled ids absent from the active set are recycled", () => {
  assert.deepEqual(staleKeys(new Set(["a", "c"]), ["a", "b", "c", "d"]).sort(), ["b", "d"]);
  assert.deepEqual(staleKeys(["a"], ["a"]), []);
  assert.deepEqual(staleKeys([], ["x", "y"]).sort(), ["x", "y"]);
});

test("createHtmlMonsterLayer: no-ops without a DOM (controller is render-loop wiring, tested live)", () => {
  // In the node test env there's no document, so the controller must be inert, never throw.
  const layer = createHtmlMonsterLayer(null);
  assert.doesNotThrow(() => layer.sync([{ id: 1, model: { base: "<div></div>" }, sx: 0, sy: 0, size: 64 }]));
  assert.doesNotThrow(() => layer.clear());
  assert.doesNotThrow(() => layer.destroy());
});
