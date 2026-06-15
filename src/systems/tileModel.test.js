import { test } from "node:test";
import assert from "node:assert/strict";
import { coerceTileVisual, hasTileVisual, tileVisualBrief, TILE_LAYER_TYPES, TILE_CANVAS } from "./tileModel.js";

// TQ-359: the tile visual builder authors a structured, clamped paint spec (safe by construction —
// no markup, so no HTML sanitizer needed). coerceTileVisual is the security/robustness boundary.

test("coerceTileVisual: accepts a valid layer list and clamps every field", () => {
  const v = coerceTileVisual({ layers: [
    { type: "gradient", dir: "radial", color: { r: 300, g: -5, b: 40 }, opacity: 9 },
    { type: "speckle", color: [10, 20, 30], density: 5, size: 9, opacity: 5 },
    { type: "cracks", color: { r: 0, g: 0, b: 0 }, count: 999, width: 9, opacity: 5 },
    { type: "patches", color: { r: 80, g: 120, b: 60 }, count: 999, radius: 999, opacity: 5 },
    { type: "glints", color: { r: 255, g: 255, b: 255 }, count: 9999, opacity: 9 },
  ] });
  assert.equal(v.layers.length, 5);
  const [grad, spec, cr, pat, gl] = v.layers;
  assert.deepEqual(grad.color, [255, 0, 40], "rgb clamped 0..255");
  assert.equal(grad.dir, "radial");
  assert.ok(grad.opacity <= 0.85 && grad.opacity >= 0, "gradient opacity clamped");
  assert.deepEqual(spec.color, [10, 20, 30], "array colour accepted");
  assert.ok(spec.density <= 1 && spec.size <= 3 && spec.opacity <= 0.6);
  assert.ok(cr.count <= 48 && cr.width <= 3 && cr.opacity <= 0.8);
  assert.ok(pat.count <= 24 && pat.radius <= 22 && pat.opacity <= 0.8);
  assert.ok(gl.count <= 80 && gl.opacity <= 0.5);
});

test("coerceTileVisual: drops unknown layer types and junk; caps the layer count", () => {
  const many = Array.from({ length: 20 }, () => ({ type: "glints" }));
  const v = coerceTileVisual({ layers: [
    { type: "script" }, { type: "img" }, "nope", null, 42, { foo: 1 }, ...many,
  ] });
  assert.ok(v, "still produces a visual from the valid glint layers");
  assert.ok(v.layers.length <= 8, "layer count capped");
  assert.ok(v.layers.every((l) => TILE_LAYER_TYPES.includes(l.type)), "only allow-listed types survive");
});

test("coerceTileVisual: a bare array of layers is accepted", () => {
  const v = coerceTileVisual([{ type: "speckle" }]);
  assert.ok(v && v.layers.length === 1 && v.layers[0].type === "speckle");
});

test("coerceTileVisual: nothing usable → null (renderer falls back to procedural grain)", () => {
  assert.equal(coerceTileVisual(null), null);
  assert.equal(coerceTileVisual({}), null);
  assert.equal(coerceTileVisual({ layers: [] }), null);
  assert.equal(coerceTileVisual({ layers: [{ type: "nope" }] }), null);
  assert.equal(coerceTileVisual("string"), null);
});

test("hasTileVisual reflects a present, non-empty layer list", () => {
  assert.equal(hasTileVisual({ visual: { layers: [{ type: "glints" }] } }), true);
  assert.equal(hasTileVisual({ visual: { layers: [] } }), false);
  assert.equal(hasTileVisual({}), false);
  assert.equal(hasTileVisual(null), false);
});

test("tileVisualBrief documents the schema (canvas size + every layer type)", () => {
  const b = tileVisualBrief();
  assert.match(b, new RegExp(`${TILE_CANVAS}x${TILE_CANVAS}`));
  for (const t of TILE_LAYER_TYPES) assert.ok(b.includes(t), `brief mentions ${t}`);
});
