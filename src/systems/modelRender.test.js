import { test } from "node:test";
import assert from "node:assert/strict";
import { coerceAuthoredModel, hasAuthoredModel, AUTHORED_MODEL_SCHEMA, authoredModelBrief } from "./modelRender.js";

test("coerceAuthoredModel: keeps valid shapes, drops junk, expands + validates hex", () => {
  const out = coerceAuthoredModel({ shapes: [
    { kind: "ellipse", cx: 64, cy: 80, rx: 30, ry: 22, rot: 15, fill: "#445", stroke: "#123", sw: 2 },
    { kind: "circle", cx: 52, cy: 74, r: 5, fill: "#ffaa00" },
    { kind: "polygon", points: [[40, 60], [64, 20], [88, 60]], fill: "#234" },
    { kind: "limb", x1: 50, y1: 98, x2: 50, y2: 120, w: 6, fill: "#223" },
    { kind: "unicorn", cx: 1, cy: 1 },       // unknown kind → dropped
    { kind: "polygon", points: [[1, 2], [3, 4]] }, // <3 points → dropped
    "not-an-object",                          // junk → dropped
  ] });
  assert.equal(out.shapes.length, 4, "4 valid shapes kept");
  assert.equal(out.shapes[0].fill, "#444455", "3-digit hex expanded to 6");
  assert.equal(out.shapes[0].stroke, "#112233");
  assert.equal(out.shapes[1].kind, "circle");
  assert.equal(out.shapes[2].points.length, 3);
});

test("coerceAuthoredModel: clamps wild coordinates + drops invalid colours; safe on junk input", () => {
  const out = coerceAuthoredModel({ shapes: [{ kind: "ellipse", cx: 9999, cy: -9999, rx: -5, ry: 1e6, fill: "tomato" }] });
  assert.ok(out.shapes[0].cx <= 160 && out.shapes[0].cy >= -32, "coords clamped to the guard band");
  assert.ok(out.shapes[0].rx >= 0.5 && out.shapes[0].ry <= 90, "radii clamped");
  // A non-hex colour is dropped, but a shape left with NEITHER fill nor stroke would render
  // invisible — so it defaults to the neutral mass instead of staying colourless.
  assert.equal(out.shapes[0].fill, "#3a3a44", "colourless shape defaults to a visible neutral fill");
  assert.deepEqual(coerceAuthoredModel(null).shapes, []);
  assert.deepEqual(coerceAuthoredModel({}).shapes, []);
  assert.deepEqual(coerceAuthoredModel({ shapes: "nope" }).shapes, []);
});

test("coerceAuthoredModel: never persists a colourless (invisible) shape, but keeps a stroke-only one hollow", () => {
  const out = coerceAuthoredModel({ shapes: [
    { kind: "ellipse", cx: 64, cy: 80, rx: 30, ry: 22 },                 // no fill/stroke → default fill
    { kind: "polygon", points: [[40, 60], [64, 20], [88, 60]], stroke: "#abc", sw: 2 }, // stroke only → stays hollow
    { kind: "circle", cx: 52, cy: 74, r: 5, fill: "#ffaa00" },           // explicit fill → untouched
    { kind: "limb", x1: 50, y1: 98, x2: 50, y2: 120, w: 6 },             // no colour → default fill (else just a shadow)
  ] });
  assert.equal(out.shapes[0].fill, "#3a3a44", "colourless ellipse gets the neutral default");
  assert.equal(out.shapes[1].fill, undefined, "a deliberate stroke-only shape is NOT force-filled");
  assert.equal(out.shapes[1].stroke, "#aabbcc", "the stroke is kept");
  assert.equal(out.shapes[2].fill, "#ffaa00", "an explicit fill is left as-is");
  assert.equal(out.shapes[3].fill, "#3a3a44", "colourless limb gets the neutral default");
});

test("coerceAuthoredModel caps the shape count (cost/complexity bound)", () => {
  const many = Array.from({ length: 200 }, () => ({ kind: "circle", cx: 64, cy: 64, r: 4, fill: "#abc" }));
  assert.ok(coerceAuthoredModel({ shapes: many }).shapes.length <= 60, "capped at 60");
});

test("hasAuthoredModel: true only with >=3 DRAWABLE authored shapes", () => {
  assert.equal(hasAuthoredModel({ model: { shapes: [{ kind: "ellipse" }, { kind: "circle" }, { kind: "polygon", points: [[1, 1], [2, 2], [3, 3]] }] } }), true);
  assert.equal(hasAuthoredModel({ model: { shapes: [{ kind: "ellipse" }, { kind: "circle" }] } }), false, "<3 → false");
  assert.equal(hasAuthoredModel({ model: { shapes: [{ kind: "x" }, { kind: "y" }, { kind: "z" }] } }), false, "no valid kinds → false");
  // A polygon with <3 points paints nothing (drawShape/coerce reject it) → it must NOT count toward
  // "authored", else a model that renders blank would skip the archetype-renderer fallback.
  assert.equal(hasAuthoredModel({ model: { shapes: [{ kind: "polygon", points: [[1, 1]] }, { kind: "polygon" }, { kind: "polygon", points: [[1, 1], [2, 2]] }] } }), false, "sub-3-point polygons don't count");
  assert.equal(hasAuthoredModel({ model: { bodyShape: "raptor" } }), false, "old archetype model → not authored");
  assert.equal(hasAuthoredModel({}), false);
  assert.equal(hasAuthoredModel(null), false);
});

test("AUTHORED_MODEL_SCHEMA is the shapes contract; brief describes the frame + primitives", () => {
  assert.ok(AUTHORED_MODEL_SCHEMA.properties.shapes);
  assert.deepEqual(AUTHORED_MODEL_SCHEMA.properties.shapes.items.properties.kind.enum, ["ellipse", "circle", "polygon", "limb"]);
  assert.ok(AUTHORED_MODEL_SCHEMA.required.includes("shapes"));
  const brief = authoredModelBrief();
  assert.match(brief, /FROM SCRATCH/);
  assert.match(brief, /128x128|0\.\.128/);
  for (const k of ["ellipse", "circle", "polygon", "limb"]) assert.ok(brief.includes(k), `brief documents ${k}`);
});
