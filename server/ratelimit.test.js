import { test } from "node:test";
import assert from "node:assert/strict";
import { createBucket, createViolationTracker, createConnLimiter } from "./ratelimit.js";

test("bucket allows up to capacity at one instant, then drops", () => {
  const b = createBucket({ capacity: 5, refillPerSec: 10 });
  for (let i = 0; i < 5; i++) assert.equal(b.take(1000), true, `take ${i}`);
  assert.equal(b.take(1000), false, "6th at the same instant is over budget");
  assert.equal(b.take(1100), true, "after 0.1s, 1 token refilled (10/s * 0.1)");
  assert.equal(b.take(1100), false);
});

test("refill is capped at capacity (no unbounded accrual)", () => {
  const b = createBucket({ capacity: 3, refillPerSec: 100 });
  for (let i = 0; i < 3; i++) assert.equal(b.take(0), true);
  assert.equal(b.take(0), false);
  // a long idle refills, but never beyond capacity
  for (let i = 0; i < 3; i++) assert.equal(b.take(10000), true);
  assert.equal(b.take(10000), false, "capped at capacity");
});

test("sustained legit rate (20 msgs/sec) is never dropped by the defaults", () => {
  const b = createBucket({ capacity: 50, refillPerSec: 30 });
  let dropped = 0;
  for (let t = 0; t <= 10000; t += 50) if (!b.take(t)) dropped++; // 10s @ 20/sec
  assert.equal(dropped, 0);
});

test("an instantaneous flood only lets `capacity` through", () => {
  const b = createBucket({ capacity: 50, refillPerSec: 30 });
  let allowed = 0;
  for (let i = 0; i < 1000; i++) if (b.take(5000)) allowed++;
  assert.equal(allowed, 50);
});

// NC-8: the old per-good-message decrement let a paced flood reset the counter.
test("violation tracker: a paced flood still trips (good msgs don't reset it)", () => {
  const v = createViolationTracker({ max: 5, decayPerSec: 1 });
  let closed = false;
  // Interleave dropped + good at the SAME instant (no elapsed time → no decay):
  // the old `violations--` on a good msg would pin it near 0 and never close.
  for (let i = 0; i < 20 && !closed; i++) {
    closed = v.record(true, 1000);          // over budget
    if (!closed) closed = v.record(false, 1000); // good (no time passes)
  }
  assert.equal(closed, true);
});

test("violation tracker: violations decay with elapsed time (idle is forgiven)", () => {
  const v = createViolationTracker({ max: 5, decayPerSec: 2 });
  v.record(true, 0); v.record(true, 0); v.record(true, 0); // 3 violations at t=0
  assert.ok(v.peek() >= 2.9);
  v.record(false, 2000); // 2s later -> decay 2*2=4 -> clamps to 0
  assert.equal(v.peek(), 0);
});

test("violation tracker: legit (no over-budget) traffic never trips", () => {
  const v = createViolationTracker({ max: 5, decayPerSec: 1 });
  let closed = false;
  for (let t = 0; t < 100; t++) closed = closed || v.record(false, t * 50);
  assert.equal(closed, false);
  assert.equal(v.peek(), 0);
});

test("createConnLimiter caps concurrent connections + frees on remove (NC-7)", () => {
  const cl = createConnLimiter({ maxTotal: 3 });
  assert.equal(cl.add(), true);
  assert.equal(cl.add(), true);
  assert.equal(cl.add(), true);
  assert.equal(cl.add(), false, "over the cap → rejected (caller closes the socket)");
  cl.remove();
  assert.equal(cl.add(), true, "a freed slot is reusable");
  assert.equal(cl.peek(), 3);
  cl.remove(); cl.remove(); cl.remove();
  cl.remove(); // never goes negative
  assert.equal(cl.peek(), 0);
});
