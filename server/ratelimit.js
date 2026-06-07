// Per-connection inbound message rate limiting (P8-T7 / P6-T2 remainder).
// A token bucket: `capacity` tokens, refilled at `refillPerSec`. Each inbound
// message consumes one token; when the bucket is empty the message is dropped.
// Pure and time-injectable (take(now)) so it's deterministically testable.
//
// Sizing: the client sends at most ~20 input msgs/sec (move throttle 0.05s) plus
// a ping every 2s, so legit play never approaches the default 30/sec refill. A
// flood (hundreds–thousands/sec) drains the bucket instantly and is dropped.
export function createBucket({ capacity = 50, refillPerSec = 30 } = {}) {
  let tokens = capacity;
  let last = 0; // first take() refills from epoch → clamps to full; harmless
  return {
    // Consume a token. Returns true if one was available (allow), false if the
    // bucket is empty (over budget — caller drops the message).
    take(now = Date.now()) {
      if (now > last) {
        tokens = Math.min(capacity, tokens + ((now - last) / 1000) * refillPerSec);
        last = now;
      }
      if (tokens >= 1) { tokens -= 1; return true; }
      return false;
    },
    // Test/introspection.
    peek() { return tokens; },
  };
}

// NC-8: a time-decayed violation counter that backs the "close a persistent
// flooder" defense. Each over-budget (dropped) message adds a violation; the
// count decays with ELAPSED TIME, not per good message. The old per-good-message
// decrement let a paced flood interleave good traffic to keep the counter pinned
// low and never trip the close. Pure + time-injectable (record(over, now)) so the
// behaviour is deterministically testable.
export function createViolationTracker({ max = 100, decayPerSec = 3 } = {}) {
  let violations = 0;
  let last = 0; // first record decays from epoch → clamps to 0; harmless
  return {
    // Call once per inbound message. `over` = was it dropped (over budget)?
    // Returns true when the count reaches `max` (caller should close the socket).
    record(over, now = Date.now()) {
      if (now > last) {
        violations = Math.max(0, violations - ((now - last) / 1000) * decayPerSec);
        last = now;
      }
      if (over) violations += 1;
      return violations >= max;
    },
    peek() { return violations; },
  };
}
