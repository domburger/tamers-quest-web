import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { recordTurn, aiMetricsSnapshot, resetAiMetrics } from "./aiMetrics.js";

beforeEach(() => resetAiMetrics());

test("empty snapshot: zeroed counters, no alert, no divide-by-zero", () => {
  const s = aiMetricsSnapshot();
  assert.equal(s.calls, 0);
  assert.equal(s.fallbackRate, 0);
  assert.equal(s.timeoutRate, 0);
  assert.equal(s.avgLatencyMs, 0);
  assert.equal(s.alert, false);
});

test("records calls, v1/v2 split, and average + max latency", () => {
  recordTurn({ ok: true, latencyMs: 100, version: "v1" });
  recordTurn({ ok: true, latencyMs: 300, version: "v2" });
  const s = aiMetricsSnapshot();
  assert.equal(s.calls, 2);
  assert.equal(s.v1, 1);
  assert.equal(s.v2, 1);
  assert.equal(s.avgLatencyMs, 200);
  assert.equal(s.maxLatencyMs, 300);
  assert.equal(s.fallbacks, 0);
  assert.equal(s.fallbackRate, 0);
});

test("fallbacks + timeouts feed the rates", () => {
  recordTurn({ ok: true, latencyMs: 50 });
  recordTurn({ ok: false, timeout: true, latencyMs: 10000 }); // a timeout fallback
  recordTurn({ ok: false, latencyMs: 20 }); // a non-timeout fallback (e.g. bad JSON)
  const s = aiMetricsSnapshot();
  assert.equal(s.calls, 3);
  assert.equal(s.fallbacks, 2);
  assert.equal(s.timeouts, 1);
  assert.equal(s.fallbackRate, 0.667);
  assert.equal(s.timeoutRate, 0.333);
});

test("alert needs BOTH a meaningful sample and a high fallback rate", () => {
  // 100% fallback but only 3 calls → below the min sample, no alert yet
  for (let i = 0; i < 3; i++) recordTurn({ ok: false, latencyMs: 5 });
  assert.equal(aiMetricsSnapshot().alert, false, "small sample doesn't trip the alert");

  resetAiMetrics();
  // 10 calls, 3 fallbacks = 30% > 20% threshold → alert
  for (let i = 0; i < 7; i++) recordTurn({ ok: true, latencyMs: 5 });
  for (let i = 0; i < 3; i++) recordTurn({ ok: false, latencyMs: 5 });
  const s = aiMetricsSnapshot();
  assert.equal(s.calls, 10);
  assert.equal(s.alert, true, "30% fallback over 10 calls trips the alert");

  resetAiMetrics();
  // 10 calls, 1 fallback = 10% < 20% → no alert
  for (let i = 0; i < 9; i++) recordTurn({ ok: true, latencyMs: 5 });
  recordTurn({ ok: false, latencyMs: 5 });
  assert.equal(aiMetricsSnapshot().alert, false, "10% fallback stays under the threshold");
});
