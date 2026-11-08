// Client-side JS error beacon (ops visibility). The browser posts uncaught errors / unhandled rejections to
// POST /api/clienterror (src/main.js installs the listeners, capped per session); the server logs one line per
// report (→ Railway logs) and keeps the last N in a ring buffer that /api/admin/stats exposes for the live-ops
// panel. Untrusted input: every field is coerced to a bounded string, bodies are size-capped by the route, and
// a per-IP budget stops a broken client (or a hostile one) from flooding the log.

const MAX_KEEP = 50;
const FIELD_MAX = { message: 300, stack: 1200, url: 200, scene: 60, ua: 160, build: 40 };
const PER_IP_PER_MIN = 10;

const ring = [];
const ipBudget = new Map(); // ip -> { count, resetAt }
let total = 0;

const clip = (v, n) => (v == null ? "" : String(v).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").slice(0, n));

/** Record one report. Returns false when the IP is over budget (the route answers 429). */
export function recordClientError(body, ip = "?", now = Date.now()) {
  let b = ipBudget.get(ip);
  if (!b || now >= b.resetAt) { b = { count: 0, resetAt: now + 60_000 }; ipBudget.set(ip, b); }
  if (b.count >= PER_IP_PER_MIN) return false;
  b.count++;
  if (ipBudget.size > 2000) for (const [k, v] of ipBudget) if (now >= v.resetAt) ipBudget.delete(k); // bounded map
  const e = { at: now, ip: clip(ip, 48) };
  for (const [k, n] of Object.entries(FIELD_MAX)) e[k] = clip(body && body[k], n);
  if (!e.message) e.message = "(no message)";
  ring.push(e);
  if (ring.length > MAX_KEEP) ring.shift();
  total++;
  console.warn(`[clienterror] ${e.message}${e.scene ? ` @${e.scene}` : ""} ${e.url ? `(${e.url})` : ""} ${e.ua ? `[${e.ua.slice(0, 60)}]` : ""}`);
  return true;
}

/** Newest first; `total` counts every accepted report since boot. */
export function clientErrorsSnapshot() {
  return { total, recent: ring.slice().reverse() };
}

export function _resetClientErrors() { ring.length = 0; ipBudget.clear(); total = 0; }
