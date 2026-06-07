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

// NC-7: cap CONCURRENT WS connections so a flood of socket opens can't exhaust
// memory (each connection holds buffers + can mint an in-memory profile). A hard
// GLOBAL cap is the reliable OOM guard regardless of source. (A per-IP cap is
// intentionally deferred: behind a proxy like Railway every socket shares the
// proxy's remoteAddress, and the real client IP via x-forwarded-for has an
// uncertain trust model — capping by the wrong value either throttles everyone or
// is trivially spoofed. Revisit once the proxy's forwarded-IP behaviour is known.)
export function createConnLimiter({ maxTotal = 600 } = {}) {
  let total = 0;
  return {
    // Returns true if accepted; false if at capacity (caller closes the socket).
    add() { if (total >= maxTotal) return false; total += 1; return true; },
    remove() { total = Math.max(0, total - 1); },
    peek() { return total; },
  };
}

// Per-key (per-IP) token bucket for HTTP endpoints — defense-in-depth against a NAIVE
// flood (e.g. a loop hammering the unauthenticated, AI-cost /api/combat/turn from one
// IP). NOT a strong control: behind a proxy the IP comes from x-forwarded-for, which a
// determined attacker can rotate/spoof — the robust fix is to auth-gate the endpoint
// (per-session-token limiting). Keep the limits GENEROUS so real, slow-paced combat
// (~one turn / few seconds, even several players behind one NAT) never trips. The map
// is bounded: when it fills, refilled-to-full (idle) keys are evicted first, then a hard
// clear as a backstop, so it can't grow without limit under an IP-rotating flood.
// The caller's IP for per-IP limiting. Behind Railway the real client IP is the first
// x-forwarded-for hop (spoofable — see createIpRateLimiter's caveat); falls back to the
// socket address, then a constant so a header-less request still buckets somewhere.
export function clientIp(req) {
  const xff = (req && req.headers && req.headers["x-forwarded-for"]) || "";
  return String(xff).split(",")[0].trim() || (req && req.socket && req.socket.remoteAddress) || "unknown";
}

export function createIpRateLimiter({ capacity = 30, refillPerSec = 1, maxIps = 10000 } = {}) {
  const buckets = new Map(); // key -> { tokens, last }
  const level = (b, now) => Math.min(capacity, b.tokens + ((now - b.last) / 1000) * refillPerSec);
  return {
    // True if the request is allowed (a token was available), false to reject (429).
    allow(key, now = Date.now()) {
      let b = buckets.get(key);
      if (!b) {
        if (buckets.size >= maxIps) {
          for (const [k, v] of buckets) if (level(v, now) >= capacity) buckets.delete(k);
          if (buckets.size >= maxIps) buckets.clear();
        }
        b = { tokens: capacity, last: now };
        buckets.set(key, b);
      }
      b.tokens = level(b, now);
      b.last = now;
      if (b.tokens < 1) return false;
      b.tokens -= 1;
      return true;
    },
    size() { return buckets.size; },
  };
}
