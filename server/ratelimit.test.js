import { test } from "node:test";
import assert from "node:assert/strict";
import { createBucket } from "./ratelimit.js";

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
