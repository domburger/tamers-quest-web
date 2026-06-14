import { test } from "node:test";
import assert from "node:assert/strict";
import { SVG_MODEL_SCHEMA, SVG_CANVAS, SVG_STATES, SVG_FORBIDDEN, hasSvgModel, svgStates } from "./svgModel.js";

test("TQ-239: SVG_MODEL_SCHEMA is the builder contract — canvas + base required, state strings present", () => {
  assert.equal(SVG_MODEL_SCHEMA.type, "object");
  assert.equal(SVG_MODEL_SCHEMA.additionalProperties, false);
  assert.deepEqual(SVG_MODEL_SCHEMA.required.sort(), ["base", "canvas"]);
  // every animation state is an authorable string property
  for (const s of SVG_STATES) assert.equal(SVG_MODEL_SCHEMA.properties[s].type, "string", `${s} is a string field`);
  assert.equal(SVG_MODEL_SCHEMA.properties.canvas.type, "integer");
  assert.equal(SVG_CANVAS, 256); // >128 per TQ-223
});

test("TQ-239: field descriptions steer the builder away from unsafe markup (defence-in-depth w/ TQ-241)", () => {
  const base = SVG_MODEL_SCHEMA.properties.base.description;
  for (const bad of ["script", "foreignObject"]) assert.ok(base.includes(bad), `base desc warns against <${bad}>`);
  assert.ok(SVG_FORBIDDEN.includes("script") && SVG_FORBIDDEN.includes("foreignObject"));
});

test("TQ-239: hasSvgModel detects a non-empty base; svgStates falls missing variants back to base", () => {
  assert.equal(hasSvgModel({ svg: { base: "<svg/>" } }), true);
  assert.equal(hasSvgModel({ svg: { base: "   " } }), false);
  assert.equal(hasSvgModel({}), false);
  const st = svgStates({ base: "B", attack: "A" });
  assert.equal(st.base, "B");
  assert.equal(st.attack, "A");
  assert.equal(st.idle, "B", "missing idle reuses base");
  assert.equal(st.move, "B", "missing move reuses base");
});
