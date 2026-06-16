import test from "node:test";
import assert from "node:assert/strict";
import { makeGenQueue, FAIL_STREAK_PAUSE } from "./genQueue.js";

const tick = () => new Promise((r) => setImmediate(r));
async function drain(steps = 250) { for (let i = 0; i < steps; i++) await tick(); }

test("genQueue: enqueue N drains all + honours the concurrency cap", async () => {
  let active = 0, peak = 0, calls = 0;
  const runGen = async (type) => { active++; peak = Math.max(peak, active); await tick(); calls++; active--; return { name: `${type}${calls}` }; };
  const q = makeGenQueue({ runGen, concurrency: 3 });
  q.enqueue("monster", 10);
  await drain();
  const s = q.status();
  assert.equal(s.done, 10);
  assert.equal(s.pending, 0);
  assert.equal(s.running, 0);
  assert.ok(peak <= 3, `peak parallelism ${peak} <= 3`);
  assert.ok(peak >= 2, "actually ran some in parallel");
});

test("genQueue: a falsy result counts as failed + the fail-streak auto-pauses (doesn't burn the whole run)", async () => {
  const q = makeGenQueue({ runGen: async () => null, concurrency: 2 });
  q.enqueue("item", 500);
  await drain();
  const s = q.status();
  assert.ok(s.paused, "auto-paused after a fail streak");
  assert.ok(s.failed >= FAIL_STREAK_PAUSE && s.failed < 500, `paused early (${s.failed} failed, not 500)`);
  assert.ok(s.lastError, "surfaces the last error for the operator");
});

test("genQueue: pause halts new jobs; clear drops pending; resume continues", async () => {
  let calls = 0;
  const runGen = async () => { await tick(); calls++; return { id: calls }; };
  const q = makeGenQueue({ runGen, concurrency: 1 });
  q.enqueue("biome", 6);
  q.pause();
  await drain(10);
  assert.ok(q.status().done <= 1, "only the already-in-flight job completes after pause");
  q.clear();
  q.resume();
  await drain();
  assert.equal(q.status().pending, 0, "cleared pending stays empty");
});

test("genQueue: endless keeps producing until cleared; setConcurrency notifies + applies", async () => {
  let concSeen = 0, calls = 0;
  const runGen = async () => { await tick(); calls++; return { id: calls }; };
  const q = makeGenQueue({ runGen, concurrency: 2, onConcurrency: (c) => { concSeen = c; } });
  assert.equal(concSeen, 2, "onConcurrency fired at construction");
  assert.equal(q.setConcurrency(5), 5);
  assert.equal(concSeen, 5, "onConcurrency fired on change");
  q.enqueue("tile", "endless");
  await drain(40);
  assert.ok(q.status().endless && q.status().done > 5, "endless mode produced many");
  const at = q.status().done;
  q.clear();
  await drain(40);
  assert.ok(q.status().done <= at + 5, "stopped producing after clear (only in-flight drained)");
});

test("genQueue: clamps concurrency to 1..MAX and rejects an unknown type", () => {
  const q = makeGenQueue({ runGen: async () => ({}) });
  assert.equal(q.setConcurrency(0), 1, "min 1");
  assert.equal(q.setConcurrency(999), q.status().maxConcurrency, "capped at MAX");
  assert.ok(q.enqueue("widget", 5).error, "unknown type rejected");
});
