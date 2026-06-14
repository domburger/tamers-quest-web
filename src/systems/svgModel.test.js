import { test } from "node:test";
import assert from "node:assert/strict";
import { SVG_MODEL_SCHEMA, SVG_CANVAS, SVG_STATES, SVG_FORBIDDEN, hasSvgModel, svgStates, svgModelBrief, sanitizeSvg, isRenderableSvg, rasterizeSvg } from "./svgModel.js";

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

test("TQ-240: svgModelBrief states the frame, the four states, and the safety constraints", () => {
  const b = svgModelBrief();
  assert.ok(b.includes(`${SVG_CANVAS} ${SVG_CANVAS}`) || b.includes(`${SVG_CANVAS}x${SVG_CANVAS}`), "names the 256 canvas/viewBox");
  for (const s of SVG_STATES) assert.ok(b.toLowerCase().includes(s), `mentions the ${s} state`);
  assert.ok(b.includes("FACES RIGHT"), "specifies facing");
  for (const bad of ["script", "foreignObject"]) assert.ok(b.includes(bad), `forbids <${bad}>`);
  assert.ok(/sole task/i.test(b), "frames it as the builder's sole task");
});

test("TQ-241: sanitizeSvg strips script/handlers/external refs, keeps clean vector + local refs", () => {
  const dirty = `<svg viewBox="0 0 256 256" onload="steal()"><script>evil()</script>` +
    `<foreignObject><div onclick="x">hi</div></foreignObject>` +
    `<image href="https://evil.example/x.png"/>` +
    `<radialGradient id="g"><stop offset="0" stop-color="#400"/></radialGradient>` +
    `<ellipse cx="128" cy="140" rx="80" ry="40" fill="url(#g)"/></svg>`;
  const clean = sanitizeSvg(dirty);
  for (const bad of ["<script", "<foreignObject", "<image", "onload=", "onclick=", "evil.example"]) {
    assert.ok(!clean.includes(bad), `removed ${bad}`);
  }
  assert.ok(clean.includes("<ellipse"), "kept the vector shape");
  assert.ok(clean.includes('fill="url(#g)"'), "kept the LOCAL gradient fragment ref");
  assert.ok(isRenderableSvg(dirty), "still a renderable <svg> after cleaning");
});

test("TQ-243: sanitizeSvg injects the SVG namespace on the root when absent (else <img>-raster is blank)", () => {
  const out = sanitizeSvg('<svg viewBox="0 0 256 256"><ellipse cx="128" cy="140" rx="80" ry="40" fill="#445"/></svg>');
  assert.match(out, /<svg[^>]*\bxmlns="http:\/\/www\.w3\.org\/2000\/svg"/, "namespace injected on the root");
  // Already-namespaced markup is left as-is (no duplicate xmlns).
  const already = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><circle r="5"/></svg>');
  assert.equal((already.match(/xmlns=/g) || []).length, 1, "no duplicate xmlns");
});

test("TQ-241: sanitizeSvg caps length; isRenderableSvg rejects junk; rasterizeSvg null on the server", async () => {
  assert.ok(sanitizeSvg("x".repeat(99999)).length <= 40000, "size-capped");
  assert.equal(isRenderableSvg("not svg at all"), false);
  assert.equal(await rasterizeSvg("<svg></svg>"), null, "no DOM on the server -> null (browser-only path)");
});
