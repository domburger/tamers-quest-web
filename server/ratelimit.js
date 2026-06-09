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
// Concurrent-WS-connection cap. `maxTotal` is the global OOM guard (NC-7). `maxPerIp`
// (0 = off) ALSO bounds how many sockets ONE client IP may hold at once — defense-in-depth
// so a single source can't grab a large share of the global pool (a flood of opens from one
// box). Keep it GENEROUS: a busy NAT / carrier-grade NAT legitimately shares one IP across
// many users, so the cap should only trip on clearly abusive single-source counts. The IP is
// the TRUSTED clientIp() hop (rightmost XFF), so it's the proxy's view of the client, not a
// spoofable leftmost entry. Per-IP counts are tracked only when maxPerIp > 0.
export function createConnLimiter({ maxTotal = 600, maxPerIp = 0 } = {}) {
  let total = 0;
  const perIp = new Map(); // ip -> live socket count (only when maxPerIp > 0)
  return {
    // Returns true if accepted; false if at the global OR per-IP cap (caller closes the socket).
    add(ip) {
      if (total >= maxTotal) return false;
      if (maxPerIp > 0 && ip) {
        const n = perIp.get(ip) || 0;
        if (n >= maxPerIp) return false;
        perIp.set(ip, n + 1);
      }
      total += 1;
      return true;
    },
    remove(ip) {
      total = Math.max(0, total - 1);
      if (maxPerIp > 0 && ip) {
        const n = (perIp.get(ip) || 0) - 1;
        if (n > 0) perIp.set(ip, n); else perIp.delete(ip);
      }
    },
    peek() { return total; },
    peekIp(ip) { return perIp.get(ip) || 0; },
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
// The caller's IP for per-IP limiting. SECURITY (audit #3): a client can PREPEND arbitrary
// hops to x-forwarded-for, so the LEFTMOST entry is attacker-controlled and trusting it makes
// every per-IP control spoofable. With one trusted reverse proxy (Railway) the real client IP
// is the hop the proxy itself APPENDED — the RIGHTMOST. We therefore count from the right by
// TRUSTED_PROXY_HOPS (default 1 = Railway's single edge proxy). Set TRUSTED_PROXY_HOPS=0 to
// distrust XFF entirely (use the socket address) — a quick rollback if a future proxy topology
// buckets users together. Falls back to socket, then a constant, so it never throws.
const TRUSTED_PROXY_HOPS = Math.max(0, parseInt(process.env.TRUSTED_PROXY_HOPS || "1", 10) || 0);
export function clientIp(req) {
  const socketIp = (req && req.socket && req.socket.remoteAddress) || "unknown";
  if (TRUSTED_PROXY_HOPS === 0) return socketIp; // don't trust forwarded headers at all
  const xff = (req && req.headers && req.headers["x-forwarded-for"]) || "";
  const hops = String(xff).split(",").map((s) => s.trim()).filter(Boolean);
  if (!hops.length) return socketIp;
  // index from the right: hops.length - N picks the Nth-from-last (our outermost trusted proxy)
  return hops[Math.max(0, hops.length - TRUSTED_PROXY_HOPS)] || socketIp;
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
