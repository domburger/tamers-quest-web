import test from "node:test";
import assert from "node:assert/strict";
import {
  HTML_CANVAS, HTML_STATES, HTML_MODEL_SCHEMA, buildHtmlModelSchema, HTML_SCHEMA_DESC_DEFAULTS,
  HTML_ALLOWED_TAGS, HTML_FORBIDDEN, hasHtmlModel, htmlStates, isRenderableHtml, coerceHtmlModel, htmlModelBrief,
} from "./htmlModel.js";

const DIV = '<div style="width:256px;height:256px;background:#345"><span style="background:#fa0"></span></div>';

test("HTML_MODEL_SCHEMA: base-only output (TQ-303) — canvas + base required; no idle/attack/move; no extra props", () => {
  assert.deepEqual(HTML_MODEL_SCHEMA.required, ["canvas", "base"]);
  assert.equal(HTML_MODEL_SCHEMA.additionalProperties, false);
  assert.deepEqual(Object.keys(HTML_MODEL_SCHEMA.properties).sort(), ["base", "canvas"]);
  for (const s of ["idle", "attack", "move"]) assert.ok(!HTML_MODEL_SCHEMA.properties[s], `${s} dropped from the builder schema (no whole-creature re-emission)`);
  assert.equal(HTML_CANVAS, 256);
});

test("buildHtmlModelSchema: base description resolves through the override-aware provider", () => {
  const schema = buildHtmlModelSchema((k) => `OVERRIDE:${k}`);
  assert.equal(schema.properties.base.description, "OVERRIDE:model.base");
  // default provider falls back to the shipped default
  assert.equal(buildHtmlModelSchema().properties.base.description, HTML_SCHEMA_DESC_DEFAULTS["model.base"]);
});

test("HTML_STATES + back-compat: storage/render still tolerate authored states on already-stored models", () => {
  // The builder no longer EMITS idle/attack/move, but HTML_STATES drives the render-path fallback and
  // coerce/sanitize still keep any authored variants on older stored models.
  assert.deepEqual(HTML_STATES, ["base", "idle", "attack", "move"]);
});

test("allow-lists + brief: presentational tags allowed, script/handlers forbidden and named in the brief", () => {
  assert.ok(HTML_ALLOWED_TAGS.includes("div") && HTML_ALLOWED_TAGS.includes("span"));
  assert.ok(!HTML_ALLOWED_TAGS.includes("script") && !HTML_ALLOWED_TAGS.includes("img"));
  for (const f of ["script", "iframe", "img", "a", "foreignObject"]) assert.ok(HTML_FORBIDDEN.includes(f), `${f} forbidden`);
  const brief = htmlModelBrief();
  assert.match(brief, /RENDER TARGET/);
  assert.match(brief, /FROM SCRATCH/);
  assert.match(brief, /script/); // forbidden list surfaced to the builder
  assert.match(brief, /256x256/);
});

test("isRenderableHtml: needs a tag + non-empty; rejects plain text/empty", () => {
  assert.ok(isRenderableHtml(DIV));
  assert.ok(!isRenderableHtml("just text"));
  assert.ok(!isRenderableHtml(""));
  assert.ok(!isRenderableHtml(null));
});

test("coerceHtmlModel: keeps base + present states, clamps canvas, drops junk; null without a base", () => {
  const m = coerceHtmlModel({ canvas: 999, base: DIV, idle: "  ", attack: '<div style="background:#111"></div>', move: "plain" });
  assert.equal(m.canvas, HTML_CANVAS, "canvas is code-authoritative");
  assert.ok(m.base.includes("<div"));
  assert.equal(m.idle, undefined, "blank variant dropped");
  assert.ok(m.attack.includes("<div"), "renderable variant kept");
  assert.equal(m.move, undefined, "non-markup variant dropped");
  assert.equal(coerceHtmlModel({ base: "no tags here" }), null, "no usable base → null (archetype fallback)");
  assert.equal(coerceHtmlModel(null), null);
});

test("hasHtmlModel + htmlStates: detector + base-fallback for missing variants", () => {
  assert.ok(hasHtmlModel({ html: { base: DIV } }));
  assert.ok(!hasHtmlModel({ html: { base: "  " } }));
  assert.ok(!hasHtmlModel({}));
  const st = htmlStates({ base: DIV, attack: '<div id="a"></div>' });
  assert.equal(st.idle, DIV, "missing idle falls back to base");
  assert.ok(st.attack.includes('id="a"'), "present attack kept");
});
