import test from "node:test";
import assert from "node:assert/strict";
import { coerceItemVisual, hasItemVisual, itemVisualBrief, ITEM_LAYER_TYPES } from "./itemModel.js";

test("coerceItemVisual: keeps valid shape layers, clamps geometry/colour to range", () => {
  const v = coerceItemVisual({ layers: [
    { type: "disc", cx: 0.5, cy: 0.5, r: 0.3, color: { r: 300, g: -5, b: 120 }, opacity: 2 },
    { type: "bar", cx: 0.5, cy: 0.5, w: 5, h: 0.2, angle: 200, color: [10, 20, 30] },
  ] });
  assert.ok(v && v.layers.length === 2);
  const disc = v.layers[0];
  assert.deepEqual(disc.color, [255, 0, 120], "colour channels clamped to 0..255");
  assert.equal(disc.opacity, 1, "opacity clamped to <=1");
  assert.ok(disc.r <= 0.5 && disc.r >= 0.02, "radius clamped");
  const bar = v.layers[1];
  assert.ok(bar.w <= 1, "bar width clamped to <=1");
  assert.ok(bar.angle <= 90 && bar.angle >= -90, "bar angle clamped to [-90,90]");
});

test("coerceItemVisual: drops unknown layer types, returns null when nothing usable", () => {
  const v = coerceItemVisual({ layers: [{ type: "wormhole" }, { type: "DISC", r: 0.2 }] });
  assert.ok(v && v.layers.length === 1, "unknown 'wormhole' dropped; case-insensitive 'DISC' kept");
  assert.equal(v.layers[0].type, "disc");
  assert.equal(coerceItemVisual({ layers: [{ type: "nope" }] }), null, "all-invalid -> null");
  assert.equal(coerceItemVisual(null), null);
  assert.equal(coerceItemVisual({}), null);
});

test("coerceItemVisual: caps layer count + accepts a bare array", () => {
  const many = Array.from({ length: 30 }, () => ({ type: "sparkle", r: 0.1 }));
  const v = coerceItemVisual(many); // bare array form
  assert.ok(v && v.layers.length <= 10, "layer count capped");
});

test("hasItemVisual: true only with >=1 layer", () => {
  assert.equal(hasItemVisual({ visual: { layers: [{ type: "disc" }] } }), true);
  assert.equal(hasItemVisual({ visual: { layers: [] } }), false);
  assert.equal(hasItemVisual({}), false);
  assert.equal(hasItemVisual(null), false);
});

test("itemVisualBrief: lists every allow-listed shape type", () => {
  const b = itemVisualBrief();
  for (const t of ITEM_LAYER_TYPES) assert.ok(b.includes(`"${t}"`), `brief documents ${t}`);
});
