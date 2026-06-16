import { test } from "node:test";
import assert from "node:assert/strict";
import { HTML_LAYER_BOX, isInPlayWindow, nodeStyle, nodeStaticStyle, staleKeys, createHtmlMonsterLayer, stateClasses, STATE_CLASSES } from "./htmlMonsterLayer.js";
import { pickStateHtml } from "../systems/htmlModel.js";

const RECT = { x: 100, y: 100, right: 400, bottom: 400 };

// ── Minimal DOM stub so the controller's class-toggle path (TQ-310) is testable in node ──
class FakeClassList {
  constructor() { this.set = new Set(); }
  toggle(c, on) { const v = on === undefined ? !this.set.has(c) : !!on; if (v) this.set.add(c); else this.set.delete(c); return v; }
  add(...cs) { for (const c of cs) this.set.add(c); }
  remove(...cs) { for (const c of cs) this.set.delete(c); }
  contains(c) { return this.set.has(c); }
}
class FakeEl {
  constructor() { this.style = {}; this._html = ""; this.htmlSets = 0; this.classList = new FakeClassList(); this.children = []; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = v; this.htmlSets++; }
  appendChild(c) { this.children.push(c); }
  remove() {}
}
function withFakeDom(fn) {
  const had = "document" in globalThis, prev = globalThis.document;
  globalThis.document = { createElement: () => new FakeEl() };
  try { return fn(); } finally { if (had) globalThis.document = prev; else delete globalThis.document; }
}

test("TQ-310 stateClasses: only the action states carry a class; idle/base carry none", () => {
  assert.deepEqual(stateClasses("move"), { "tq-moving": true, "tq-attacking": false });
  assert.deepEqual(stateClasses("attack"), { "tq-moving": false, "tq-attacking": true });
  assert.deepEqual(stateClasses("idle"), { "tq-moving": false, "tq-attacking": false });
  assert.deepEqual(stateClasses("base"), { "tq-moving": false, "tq-attacking": false });
  assert.deepEqual(STATE_CLASSES, ["tq-moving", "tq-attacking"]);
});

test("TQ-310 sync (base-only): state changes TOGGLE the class, never re-set innerHTML", () => {
  withFakeDom(() => {
    const mount = new FakeEl();
    const layer = createHtmlMonsterLayer(mount);
    const model = { base: "<div>base</div>" }; // base-only (the post-TQ-303 norm)
    const m = (state) => [{ id: 1, model, state, sx: 0, sy: 0, size: 64 }];
    layer.sync(m("idle"));
    const el = mount.children[0];
    assert.equal(el.htmlSets, 1, "base rendered once");
    assert.match(el.innerHTML, /tq-mon-anim/, "TQ-386: creature wrapped in the engine motion layer the .tq-* classes drive");
    assert.ok(!el.classList.contains("tq-moving") && !el.classList.contains("tq-attacking"), "idle → no action class");
    layer.sync(m("attack"));
    assert.equal(el.htmlSets, 1, "attack must NOT re-set innerHTML (would restart the idle animation)");
    assert.ok(el.classList.contains("tq-attacking") && !el.classList.contains("tq-moving"), "attack → tq-attacking");
    layer.sync(m("move"));
    assert.equal(el.htmlSets, 1, "still no innerHTML re-set");
    assert.ok(el.classList.contains("tq-moving") && !el.classList.contains("tq-attacking"), "move → tq-moving");
    layer.sync(m("idle"));
    assert.ok(!el.classList.contains("tq-moving") && !el.classList.contains("tq-attacking"), "back to idle → classes cleared");
  });
});

test("TQ-310 sync: a recycled node clears its action classes (no stale tq-attacking)", () => {
  withFakeDom(() => {
    const mount = new FakeEl();
    const layer = createHtmlMonsterLayer(mount);
    const model = { base: "<div>b</div>" };
    layer.sync([{ id: 7, model, state: "attack", sx: 0, sy: 0, size: 64 }]);
    const el = mount.children[0];
    assert.ok(el.classList.contains("tq-attacking"));
    layer.sync([]); // monster 7 gone → node released to the pool
    assert.ok(!el.classList.contains("tq-attacking"), "released node dropped its action class");
  });
});

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

test("nodeStyle: scales the 256-box to size, centres it via transform, mirrors on left-facing", () => {
  const s = nodeStyle({ sx: 250, sy: 180, size: 128, opacity: 0.5, facing: 1 });
  // TQ-415: per-frame style is transform/opacity/zIndex ONLY — no left/top/width/height (those are
  // static, set once in acquire via nodeStaticStyle). Position rides on the transform's leading translate.
  assert.equal(s.left, undefined);
  assert.equal(s.top, undefined);
  assert.equal(s.width, undefined);
  assert.equal(s.opacity, "0.5");
  assert.match(s.transform, /translate\(250px, 180px\)/); // screen position on the transform
  assert.match(s.transform, /translate\(-50%, -50%\)/);   // centring offset preserved
  assert.match(s.transform, /scale\(0\.5, 0\.5\)/);       // 128/256
  // left-facing mirrors X only (negative X scale, same magnitude)
  const l = nodeStyle({ sx: 0, sy: 0, size: 256, facing: -1 });
  assert.match(l.transform, /scale\(-1, 1\)/);
  // defaults: opacity 1, facing right
  const d = nodeStyle({ sx: 0, sy: 0, size: 256 });
  assert.equal(d.opacity, "1");
  assert.match(d.transform, /scale\(1, 1\)/);
});

test("nodeStaticStyle: the box geometry set once per node — constant, left/top anchored at origin", () => {
  const st = nodeStaticStyle();
  assert.equal(st.position, "absolute");
  assert.equal(st.left, "0");
  assert.equal(st.top, "0");
  assert.equal(st.width, "256px");
  assert.equal(st.height, "256px");
  assert.equal(st.transformOrigin, "center center");
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
