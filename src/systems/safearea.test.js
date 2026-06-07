import test from "node:test";
import assert from "node:assert/strict";
import { readSafeAreaInsets } from "./safearea.js";

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
