import { test } from "node:test";
import assert from "node:assert/strict";
import { syncDetailHtml, _resetDetailHtml } from "./monsterDetailHtml.js";

const fakeK = { worldToScreen: (x, y) => ({ x, y, scale: 1 }) };
const htmlMt = { typeName: "DomMon", html: { canvas: 256, base: "<div style='width:256px;height:256px'></div>" } };

test("syncDetailHtml: no-ops (returns false) without a DOM, never throws", () => {
  // node test env has no `document` — the function must early-return false and not throw.
  assert.equal(typeof document, "undefined");
  assert.doesNotThrow(() => {
    assert.equal(syncDetailHtml(fakeK, htmlMt, 100, 100, 140), false);
    assert.equal(syncDetailHtml(fakeK, { typeName: "X" }, 100, 100, 140), false); // non-html monster
    assert.equal(syncDetailHtml(fakeK, null, 100, 100, 140), false);
    assert.equal(syncDetailHtml({}, htmlMt, 100, 100, 140), false); // no worldToScreen
  });
  _resetDetailHtml();
});
