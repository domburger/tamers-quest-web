const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 16;
const FAIL_STREAK_PAUSE = 12;
const RECENT_CAP = 30;

const clampConc = (n) => Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(Number(n) || 0) || 1));
const VALID_TYPES = new Set(["monster", "item", "biome", "tile"]);

export function makeGenQueue({ runGen, onConcurrency, concurrency = DEFAULT_CONCURRENCY, now = () => Date.now() } = {}) {
  if (typeof runGen !== "function") throw new TypeError("makeGenQueue: runGen must be a function");
  const pending = [];
  let running = 0, done = 0, failed = 0, paused = false, seq = 0, failStreak = 0, lastError = null;
  let endless = null;
  let conc = clampConc(concurrency);
  const recent = [];
  const applyConc = (c) => { try { onConcurrency && onConcurrency(c); } catch {} };
  applyConc(conc);

  function record(job, ok, result, err) {
    if (ok) { done++; failStreak = 0; }
    else { failed++; failStreak++; lastError = (err && err.message) || (err ? String(err) : "generation returned null (AI off / rejected / failed)"); }
    recent.push({ id: job.id, type: job.type, ok: !!ok, name: ok ? genName(job.type, result) : null, at: now(), error: ok ? null : lastError });
    if (recent.length > RECENT_CAP) recent.shift();
    if (failStreak >= FAIL_STREAK_PAUSE) paused = true;
  }

  function nextJob() {
    if (pending.length) return pending.shift();
    if (endless) return { id: ++seq, type: endless.type, opts: endless.opts };
    return null;
  }

  function pump() {
    while (!paused && running < conc) {
      const job = nextJob();
      if (!job) break;
      running++;
      Promise.resolve()
        .then(() => runGen(job.type, job.opts))
        .then((r) => record(job, !!r, r), (e) => record(job, false, null, e))
        .then(() => { running--; pump(); });
    }
  }

  return {
    enqueue(type, count, opts = {}) {
      const t = String(type || "monster");
      if (!VALID_TYPES.has(t)) return { error: `unknown type: ${t}` };
      if (count === "endless" || count === Infinity) { endless = { type: t, opts: opts || {} }; failStreak = 0; paused = false; pump(); return { endless: true }; }
      const n = Math.max(0, Math.floor(Number(count) || 0));
      for (let i = 0; i < n; i++) pending.push({ id: ++seq, type: t, opts: opts || {} });
      if (n > 0) { failStreak = 0; paused = false; }
      pump();
      return { queued: n };
    },
    pause() { paused = true; },
    resume() { paused = false; failStreak = 0; pump(); },
    clear() { pending.length = 0; endless = null; },
    setConcurrency(n) { conc = clampConc(n); applyConc(conc); pump(); return conc; },
    status() {
      return {
        running, done, failed, paused, concurrency: conc, maxConcurrency: MAX_CONCURRENCY,
        pending: pending.length, endless: !!endless, endlessType: endless ? endless.type : null,
        failStreak, lastError, recent: recent.slice(-12).reverse(),
      };
    },
  };
}

function genName(type, r) {
  if (!r || typeof r !== "object") return null;
  return r.typeName || r.name || (r.id != null ? `${type} #${r.id}` : type);
}

export { DEFAULT_CONCURRENCY, MAX_CONCURRENCY, FAIL_STREAK_PAUSE };
