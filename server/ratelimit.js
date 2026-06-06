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
