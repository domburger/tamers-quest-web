export function createBucket({ capacity = 50, refillPerSec = 30 } = {}) {
  let tokens = capacity;
  let last = 0;
  return {
    take(now = Date.now()) {
      if (now > last) {
        tokens = Math.min(capacity, tokens + ((now - last) / 1000) * refillPerSec);
        last = now;
      }
      if (tokens >= 1) { tokens -= 1; return true; }
      return false;
    },
    peek() { return tokens; },
  };
}

// Decay by elapsed time, not per good message (paced floods would evade the close).
export function createViolationTracker({ max = 100, decayPerSec = 3 } = {}) {
  let violations = 0;
  let last = 0;
  return {
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

export function createConnLimiter({ maxTotal = 600, maxPerIp = 0 } = {}) {
  let total = 0;
  const perIp = new Map();
  return {
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

// Never trust the leftmost XFF hop (client-controlled); count from the right.
const TRUSTED_PROXY_HOPS = Math.max(0, parseInt(process.env.TRUSTED_PROXY_HOPS || "1", 10) || 0);
export function clientIp(req) {
  const socketIp = (req && req.socket && req.socket.remoteAddress) || "unknown";
  if (TRUSTED_PROXY_HOPS === 0) return socketIp;
  const xff = (req && req.headers && req.headers["x-forwarded-for"]) || "";
  const hops = String(xff).split(",").map((s) => s.trim()).filter(Boolean);
  if (!hops.length) return socketIp;
  return hops[Math.max(0, hops.length - TRUSTED_PROXY_HOPS)] || socketIp;
}

export function createIpRateLimiter({ capacity = 30, refillPerSec = 1, maxIps = 10000 } = {}) {
  const buckets = new Map();
  const level = (b, now) => Math.min(capacity, b.tokens + ((now - b.last) / 1000) * refillPerSec);
  return {
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
