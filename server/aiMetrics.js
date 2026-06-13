// Fight-agent observability (TQ-40): in-memory counters for AI combat-turn judging — call volume,
// engine-fallback rate, timeout rate, v1/v2 split, and latency — so /api/admin/stats can surface
// the judge's health and a fallback-rate spike is visible to live-ops. In-memory + process-lifetime
// (resets on restart); monitoring doesn't need persistence. Pure + dependency-free → unit-testable.

const FALLBACK_RATE_ALERT = 0.2; // >=20% of judged turns falling back to the engine = degraded
const ALERT_MIN_SAMPLE = 10; // don't trip the alert until there's a meaningful sample

const m = { calls: 0, fallbacks: 0, timeouts: 0, totalLatencyMs: 0, maxLatencyMs: 0, v1: 0, v2: 0, since: null };

// Record one combat-turn judge attempt. ok=false ⇒ it threw and the deterministic engine resolved
// the turn (a fallback); timeout=true marks the AI_TIMEOUT_MS abort case. latencyMs is the wall time
// of the attempt (success OR failure). version is "v1" | "v2".
export function recordTurn({ ok, timeout = false, latencyMs = 0, version = "v1" } = {}) {
  if (m.since == null) m.since = Date.now();
  m.calls++;
  if (version === "v2") m.v2++; else m.v1++;
  const lat = Math.max(0, Math.round(Number(latencyMs) || 0));
  m.totalLatencyMs += lat;
  if (lat > m.maxLatencyMs) m.maxLatencyMs = lat;
  if (!ok) m.fallbacks++;
  if (timeout) m.timeouts++;
}

// A snapshot for the admin stats panel: raw counters + derived rates + an `alert` flag that trips
// once the fallback rate crosses the threshold over a meaningful sample.
export function aiMetricsSnapshot() {
  const calls = m.calls;
  const fallbackRate = calls ? m.fallbacks / calls : 0;
  const timeoutRate = calls ? m.timeouts / calls : 0;
  return {
    calls,
    fallbacks: m.fallbacks,
    timeouts: m.timeouts,
    v1: m.v1,
    v2: m.v2,
    avgLatencyMs: calls ? Math.round(m.totalLatencyMs / calls) : 0,
    maxLatencyMs: m.maxLatencyMs,
    fallbackRate: round3(fallbackRate),
    timeoutRate: round3(timeoutRate),
    alert: calls >= ALERT_MIN_SAMPLE && fallbackRate >= FALLBACK_RATE_ALERT,
    alertThreshold: FALLBACK_RATE_ALERT,
    since: m.since,
  };
}

// Test hook — reset the process-lifetime counters.
export function resetAiMetrics() {
  Object.assign(m, { calls: 0, fallbacks: 0, timeouts: 0, totalLatencyMs: 0, maxLatencyMs: 0, v1: 0, v2: 0, since: null });
}

function round3(n) { return Math.round(n * 1000) / 1000; }
