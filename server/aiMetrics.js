const FALLBACK_RATE_ALERT = 0.2;
const ALERT_MIN_SAMPLE = 10;

const m = { calls: 0, fallbacks: 0, timeouts: 0, totalLatencyMs: 0, maxLatencyMs: 0, v1: 0, v2: 0, since: null };

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

export function resetAiMetrics() {
  Object.assign(m, { calls: 0, fallbacks: 0, timeouts: 0, totalLatencyMs: 0, maxLatencyMs: 0, v1: 0, v2: 0, since: null });
}

function round3(n) { return Math.round(n * 1000) / 1000; }
