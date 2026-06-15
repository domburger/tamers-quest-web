import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeHtml, sanitizeCss, sanitizeHtmlModel, isSafeHtml, stripRootBackground } from "./htmlSanitize.js";
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

test("TQ-305: a valid <style> @keyframes survives, is name-scoped, and inline references are rewritten to match", () => {
  const m = `<div style="animation: breathe 2.4s ease-in-out infinite"><style>@keyframes breathe{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}</style></div>`;
  const out = sanitizeHtml(m);
  assert.match(out, /<style>@keyframes kf[0-9a-z]+_breathe\{/, "keyframes kept + name scoped per-fragment");
  const scoped = out.match(/@keyframes (kf[0-9a-z]+_breathe)\b/)[1];
  assert.match(out, new RegExp(`animation: ${scoped} 2\\.4s`), "inline animation reference rewritten to the SAME scoped name");
  assert.match(out, /transform: scale\(1\.06\)/, "safe keyframe declarations kept");
});

test("TQ-305: hostile <style> is neutralised — selectors/@import/url()/empty dropped entirely", () => {
  for (const m of [
    `<div><style>body{background:url(http://evil/x)}</style></div>`,                  // selector rule → no keyframes → dropped
    `<div><style>@import url(//evil.css);</style></div>`,                              // @import → dropped
    `<div><style>@keyframes x{0%{background:url(javascript:alert(1))}}</style></div>`, // only bad decls → empty → dropped
    `<div><style>@keyframes a{}</style></div>`,                                        // empty body → dropped
  ]) {
    const out = sanitizeHtml(m);
    assertInert(out, `hostile style: ${m}`); // no <style>, no url(), no @import, no javascript:, etc.
    assert.match(out, /<div/, "the host element itself survives");
  }
});

test("TQ-305: </style> breakout cannot smuggle script; keyframes sanitise is idempotent", () => {
  const evil = `<div><style>@keyframes x{0%{opacity:1}}</style><script>alert(1)</script></div>`;
  const out = sanitizeHtml(evil);
  assert.ok(!/script/i.test(out) && !/alert/i.test(out), "the sibling <script> is stripped");
  assert.match(out, /@keyframes kf[0-9a-z]+_x\{/, "the valid keyframes still survive");
  const ok = `<div style="animation: pulse 1.5s linear infinite"><style>@keyframes pulse{0%{opacity:0.6}100%{opacity:1}}</style></div>`;
  const once = sanitizeHtml(ok);
  assert.equal(sanitizeHtml(once), once, "keyframes sanitise is idempotent (names not re-scoped)");
});

test("TQ-310: action-class-scoped rules (.tq-moving/.tq-attacking + descendants) survive, scoped to their @keyframes", () => {
  const m = `<div style="animation: idle 2s infinite"><style>@keyframes idle{0%{opacity:1}100%{opacity:1}}@keyframes lunge{0%{transform:none}100%{transform:translateX(8px)}}.tq-attacking{animation:lunge .3s ease}.tq-moving .leg{transform:rotate(10deg)}</style></div>`;
  const out = sanitizeHtml(m);
  // the action rules survive, scoped under the engine classes
  assert.match(out, /\.tq-attacking\{animation:\s*kf[0-9a-z]+_lunge\s+\.3s\s+ease\}/, "tq-attacking rule kept + its animation-name scoped to the keyframes");
  assert.match(out, /\.tq-moving \.leg\{transform:\s*rotate\(10deg\)\}/, "descendant-scoped rule kept");
  assert.match(out, /@keyframes kf[0-9a-z]+_lunge\{/, "the referenced keyframes is kept + scoped");
});

test("TQ-310: only .tq-moving/.tq-attacking-scoped selectors survive — everything else is dropped", () => {
  const cases = [
    [`<div><style>body{background:red}</style></div>`, /\bbody\s*\{/, "global element rule"],
    [`<div><style>.evil{opacity:0}</style></div>`, /evil/, "arbitrary class rule"],
    [`<div><style>.tq-attacking:hover{opacity:0}</style></div>`, /:hover/, "pseudo on the action class"],
    [`<div><style>.tq-attacking,div{opacity:0}</style></div>`, /,\s*div|\bdiv\s*\{/, "selector list"],
    [`<div><style>.tq-attacking>div{opacity:0}</style></div>`, />\s*div/, "child combinator"],
    [`<div><style>*{opacity:0}</style></div>`, /\*\s*\{/, "universal selector"],
  ];
  for (const [m, banned, label] of cases) {
    const out = sanitizeHtml(m);
    assert.ok(!banned.test(out), `${label}: disallowed selector must be dropped — got: ${out}`);
  }
});

test("TQ-310: hostile action-class rules are neutralised (url/expression dropped; no </style> breakout)", () => {
  for (const m of [
    `<div><style>.tq-attacking{background:url(http://evil/x)}</style></div>`,             // url() in decls → dropped
    `<div><style>.tq-attacking{background:expression(alert(1))}</style></div>`,           // expression() → dropped
    `<div><style>.tq-attacking{}</style><script>alert(1)</script></div>`,                  // empty rule + sibling script
    `<div><style>.tq-attacking{x:y}</style><img src=x onerror=alert(1)></div>`,            // sibling event-handler tag
  ]) {
    assertInert(sanitizeHtml(m), `hostile tq rule: ${m}`);
  }
  // position:fixed is stripped from an otherwise-valid action rule (it would escape the canvas box);
  // the harmless remainder (top:0) may stay, so assert the dangerous prop is gone (not the whole block).
  const fx = sanitizeHtml(`<div><style>.tq-moving{position:fixed;top:0}</style></div>`);
  assert.ok(!/position/i.test(fx) && !/fixed/i.test(fx), `position:fixed stripped — got: ${fx}`);
  // a kept action rule is idempotent (re-sanitise is stable; names not re-scoped)
  const ok = `<div><style>@keyframes p{0%{opacity:1}100%{opacity:1}}.tq-attacking{animation:p 1s}</style></div>`;
  const once = sanitizeHtml(ok);
  assert.equal(sanitizeHtml(once), once, "action-rule sanitise is idempotent");
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

test("TQ-332: stripRootBackground drops the ROOT element's background (no dark box), keeps inner shapes", () => {
  // Root background (the bug) is stripped; inner element backgrounds (the creature's body) are kept.
  const out = stripRootBackground('<div style="width:256px;height:256px;background:#07070d;border-radius:8px"><span style="background:#a33;width:40px"></span></div>');
  assert.ok(!/background:\s*#07070d/i.test(out), "root background removed");
  assert.ok(/width:\s*256px/i.test(out) && /height:\s*256px/i.test(out) && /border-radius:\s*8px/i.test(out), "root's other styles kept");
  assert.ok(/background:\s*#a33/i.test(out), "inner shape background kept");
  // background-color / background-image on the root are also dropped.
  const g = stripRootBackground('<div style="background-image:linear-gradient(#111,#222);width:256px"></div>');
  assert.ok(!/background-image/i.test(g) && /width:\s*256px/i.test(g));
  const c = stripRootBackground('<div style="background-color:#000;height:256px"></div>');
  assert.ok(!/background-color/i.test(c) && /height:\s*256px/i.test(c));
});

test("TQ-332: sanitizeHtmlModel renders a transparent-root base (no opaque box)", () => {
  const m = sanitizeHtmlModel({ canvas: 256, base: '<div style="width:256px;height:256px;background:#07070d"><div style="background:#c44;width:30px;height:30px"></div></div>' });
  assert.ok(m && typeof m.base === "string");
  assert.ok(!/background:\s*#07070d/i.test(m.base), "the dark root box is gone");
  assert.ok(/background:\s*#c44/i.test(m.base), "the creature's inner fill stays");
});
