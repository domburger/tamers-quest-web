import { test } from "node:test";
import assert from "node:assert/strict";
import { recordClientError, clientErrorsSnapshot, _resetClientErrors } from "./clientErrors.js";

test("clientErrors: records bounded, sanitized fields newest-first and counts totals", () => {
  _resetClientErrors();
  const origWarn = console.warn; console.warn = () => {};
  try {
    assert.equal(recordClientError({ message: "boom\u0007\n" + "x".repeat(500), stack: "s", url: "/", scene: "hub", ua: "UA", build: "abc" }, "1.1.1.1"), true);
    assert.equal(recordClientError({}, "1.1.1.1"), true);
    const snap = clientErrorsSnapshot();
    assert.equal(snap.total, 2);
    assert.equal(snap.recent[0].message, "(no message)", "newest first; missing message gets a placeholder");
    assert.ok(snap.recent[1].message.length <= 300 && !snap.recent[1].message.includes("\u0007"), "clipped + control chars stripped (newline kept)");
    assert.equal(snap.recent[1].scene, "hub");
  } finally { console.warn = origWarn; }
});

test("clientErrors: per-IP budget (10/min) → false; ring keeps the last 50", () => {
  _resetClientErrors();
  const origWarn = console.warn; console.warn = () => {};
  try {
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) assert.equal(recordClientError({ message: "e" + i }, "9.9.9.9", t0), true);
    assert.equal(recordClientError({ message: "over" }, "9.9.9.9", t0 + 1000), false, "11th in the minute rejected");
    assert.equal(recordClientError({ message: "later" }, "9.9.9.9", t0 + 61_000), true, "budget resets after a minute");
    for (let i = 0; i < 60; i++) recordClientError({ message: "r" + i }, "ip" + i, t0);
    const snap = clientErrorsSnapshot();
    assert.equal(snap.recent.length, 50, "ring capped at 50");
    assert.equal(snap.recent[0].message, "r59", "newest first");
  } finally { console.warn = origWarn; }
});
