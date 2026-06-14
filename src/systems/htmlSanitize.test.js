import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeHtml, sanitizeCss, sanitizeHtmlModel, isSafeHtml } from "./htmlSanitize.js";
import { HTML_CANVAS } from "./htmlModel.js";

// TQ-261: the sanitizer is the ONLY defense for live-DOM monster HTML — assert every hostile fixture
// is NEUTRALISED. (node has no DOMParser, so these exercise the string-sanitise pass — the server
// path + the base of the client path; the client adds a DOMParser re-sanitise on top.)

// A sanitised string must never contain any execution / external-fetch / event-wiring vector.
const assertInert = (out, label) => {
  for (const bad of [/<script/i, /<\/script/i, /<style/i, /<iframe/i, /<img/i, /<object/i, /<embed/i,
    /<a[\s>]/i, /<form/i, /<input/i, /<link/i, /<meta/i, /\son\w+\s*=/i, /javascript:/i, /vbscript:/i,
    /expression\s*\(/i, /@import/i, /behavior\s*:/i, /-moz-binding/i, /url\s*\(\s*(?!#)/i, /position\s*:\s*fixed/i]) {
    assert.ok(!bad.test(out), `${label}: must not contain ${bad} — got: ${out}`);
  }
};

test("TQ-261: strips <script> (paired, unclosed, and comment/CDATA-obfuscated)", () => {
  for (const m of [
    `<div><script>alert(1)</script></div>`,
    `<div><script>alert(1)`,
    `<div><scr<!-- -->ipt>alert(1)</script></div>`,
    `<div><![CDATA[<script>alert(1)</script>]]></div>`,
    `<div><!-- <script>alert(1)</script> --></div>`,
    `<SCRIPT SRC=//evil></SCRIPT>`,
  ]) assertInert(sanitizeHtml(m), `script: ${m}`);
});

test("TQ-261: strips event handlers + javascript:/vbscript:/data: vectors", () => {
  for (const m of [
    `<div onclick="evil()">x</div>`,
    `<div onmouseover=alert(1)>x</div>`,
    `<svg><circle onload="alert(1)" r="5"/></svg>`,
    `<div STYLE="x" onerror="alert(1)">x</div>`,
    `<div style="background:url(javascript:alert(1))">x</div>`,
  ]) assertInert(sanitizeHtml(m), `handler: ${m}`);
});

test("TQ-261: drops disallowed tags entirely (img/iframe/a/form/input/object/link/meta)", () => {
  for (const m of [
    `<img src=x onerror=alert(1)>`,
    `<iframe src="//evil"></iframe>`,
    `<a href="javascript:alert(1)">x</a>`,
    `<form action="//evil"><input value="y"></form>`,
    `<object data="evil.swf"></object>`,
    `<link rel=stylesheet href="//evil.css">`,
    `<meta http-equiv=refresh content="0;url=//evil">`,
  ]) {
    const out = sanitizeHtml(m);
    assertInert(out, `disallowed: ${m}`);
  }
});

test("TQ-261: CSS sanitiser keeps safe props, drops url()/expression()/@import/behavior/position:fixed", () => {
  assert.equal(sanitizeCss("color:#fff; width:50px; transform:rotate(10deg)"),
    "color: #fff; width: 50px; transform: rotate(10deg)", "safe props pass through");
  for (const css of [
    "background:url(http://evil/x.png)",
    "background:url(data:image/png;base64,AAAA)",
    "width:expression(alert(1))",
    "behavior:url(x.htc)",
    "x:y;@import url(evil)",
    "-moz-binding:url(evil.xml)",
    "position:fixed; top:0; left:0",
    "background:url(javascript:alert(1))",
  ]) {
    const out = sanitizeCss(css);
    assertInert(`<div style="${out}">`, `css: ${css}`);
  }
  // position:absolute is allowed (clamped by the render container); only fixed is dropped.
  assert.match(sanitizeCss("position:absolute; left:10px"), /position: absolute/);
});

test("TQ-261: allowed presentational markup survives (div/span + inline svg + gradient url(#ref))", () => {
  const ok = `<div style="position:relative; width:256px; height:256px"><span style="background:#222; border-radius:8px"></span><svg viewBox="0 0 256 256"><defs><linearGradient id="g"><stop offset="0" stop-color="#400"/></linearGradient></defs><ellipse cx="128" cy="128" rx="60" ry="40" fill="url(#g)"/></svg></div>`;
  const out = sanitizeHtml(ok);
  assert.match(out, /<div /);
  assert.match(out, /<span /);
  assert.match(out, /<svg /);
  assert.match(out, /<ellipse /);
  assert.match(out, /fill="url\(#g\)"/, "local gradient ref is preserved");
  assert.match(out, /position: relative/);
  assert.match(out, /border-radius: 8px/);
  assertInert(out, "clean markup stays inert");
});

test("TQ-261: idempotent + size-capped", () => {
  const m = `<div style="color:#0f0; position:fixed"><script>x</script><span onclick=y()>hi</span></div>`;
  const once = sanitizeHtml(m);
  assert.equal(sanitizeHtml(once), once, "sanitise is idempotent");
  const huge = "<div>" + "a".repeat(50000) + "</div>";
  assert.ok(sanitizeHtml(huge).length <= 20001, "output is length-capped");
});

test("TQ-261: sanitizeHtmlModel — base required, states sanitised, canvas clamped, hostile base → null", () => {
  const model = sanitizeHtmlModel({
    canvas: 9999,
    base: `<div style="background:#111"><script>evil()</script></div>`,
    idle: `<div style="transform:scale(1.02)" onclick="x()"></div>`,
    attack: `<iframe src=//evil></iframe>`, // sanitises to empty → dropped (falls back to base)
  });
  assert.ok(model, "a usable base yields a model");
  assert.equal(model.canvas, HTML_CANVAS, "canvas clamped to the code-authoritative size");
  assertInert(model.base, "model.base");
  assertInert(model.idle, "model.idle");
  assert.match(model.idle, /transform: scale\(1\.02\)/, "safe idle CSS kept");
  assert.equal(model.attack, undefined, "an all-stripped state is dropped (→ base fallback)");

  assert.equal(sanitizeHtmlModel({ base: `<script>only evil</script>` }), null, "no usable element → null model");
  assert.equal(sanitizeHtmlModel({ base: "just text" }), null, "plain text base → null model");
  assert.equal(sanitizeHtmlModel(null), null, "nullish → null");
  assert.equal(isSafeHtml(`<img onerror=alert(1)>`), false, "isSafeHtml false when nothing survives");
  assert.equal(isSafeHtml(`<div>x</div>`), true, "isSafeHtml true for a real element");
});
