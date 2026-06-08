import test from "node:test";
import assert from "node:assert/strict";
import { readSafeAreaInsets, safeInsetsDesign } from "./safearea.js";

test("readSafeAreaInsets: zeros in a non-browser context (no document)", () => {
  assert.deepEqual(readSafeAreaInsets(), { top: 0, right: 0, bottom: 0, left: 0 });
});

test("readSafeAreaInsets: reads the probe element's resolved padding", () => {
  const appended = [];
  global.document = { body: { appendChild: (el) => appended.push(el) }, createElement: () => ({ style: {}, remove() {} }) };
  global.getComputedStyle = () => ({ paddingTop: "44px", paddingRight: "0px", paddingBottom: "34px", paddingLeft: "0px" });
  try {
    assert.deepEqual(readSafeAreaInsets(), { top: 44, right: 0, bottom: 34, left: 0 });
    assert.equal(appended.length, 1); // probe was attached then read
  } finally {
    delete global.document;
    delete global.getComputedStyle;
  }
});

test("readSafeAreaInsets: negative / non-numeric padding clamps to 0", () => {
  global.document = { body: { appendChild() {} }, createElement: () => ({ style: {}, remove() {} }) };
  global.getComputedStyle = () => ({ paddingTop: "auto", paddingRight: "-5px", paddingBottom: "", paddingLeft: "12px" });
  try {
    assert.deepEqual(readSafeAreaInsets(), { top: 0, right: 0, bottom: 0, left: 12 });
  } finally {
    delete global.document;
    delete global.getComputedStyle;
  }
});

test("readSafeAreaInsets: zeros (no throw) when getComputedStyle is unavailable", () => {
  global.document = { body: { appendChild() {} }, createElement: () => ({ style: {}, remove() {} }) };
  try {
    assert.deepEqual(readSafeAreaInsets(), { top: 0, right: 0, bottom: 0, left: 0 });
  } finally {
    delete global.document;
  }
});

test("safeInsetsDesign: zeros off-browser and never throws on bad k", () => {
  assert.deepEqual(safeInsetsDesign({ height: () => 720 }), { top: 0, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(safeInsetsDesign(undefined), { top: 0, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(safeInsetsDesign({}), { top: 0, right: 0, bottom: 0, left: 0 });
});

test("safeInsetsDesign: converts CSS-px insets to design units by the canvas scale", () => {
  // Canvas is 1440 CSS px tall for a 720 design height → 2 CSS px per design unit, so a
  // 44px CSS top inset = 22 design units.
  global.document = {
    body: { appendChild() {} },
    createElement: () => ({ style: {}, remove() {} }),
    querySelector: () => ({ getBoundingClientRect: () => ({ height: 1440 }) }),
  };
  global.getComputedStyle = () => ({ paddingTop: "44px", paddingRight: "0px", paddingBottom: "20px", paddingLeft: "0px" });
  try {
    const d = safeInsetsDesign({ height: () => 720 });
    assert.ok(Math.abs(d.top - 22) < 1e-9, "44 CSS px / 2 = 22 design units");
    assert.ok(Math.abs(d.bottom - 10) < 1e-9, "20 CSS px / 2 = 10 design units");
    assert.equal(d.left, 0);
  } finally {
    delete global.document;
    delete global.getComputedStyle;
  }
});
