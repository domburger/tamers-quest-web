// TQ-492: admin BULK-GENERATION QUEUE. The gen hub used to fire one generation at a time (manual click,
// single-flight). This lets an operator enqueue many — 50, 1000, or ENDLESS — content generations and a
// worker pool drains them with a configurable CONCURRENCY ("some in parallel"), with pause/resume/clear
// and live progress. Each job runs the live gen pipeline and AUTO-SAVES to the pool (non-dryRun).
//
// Design: pure + injectable. makeGenQueue({ runGen, ... }) takes the generator fn (type, opts) => Promise
// so the engine is unit-testable without real AI calls. The app wires the default singleton (bottom) to
// content.js's generate*; setting concurrency also raises content's monster single-flight cap so monster
// jobs can actually run in parallel (item/biome/tile already do). NOT busy-looping: pump() launches up to
// `concurrency` async jobs then waits; each job's completion refills exactly one slot.

const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 16;        // soft cap — beyond this the AI API rate-limits + cost balloons
const FAIL_STREAK_PAUSE = 12;      // auto-pause after this many CONSECUTIVE failures (AI down / rate-limited / bad config)
const RECENT_CAP = 30;             // ring of recent outcomes for the admin display

const clampConc = (n) => Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(Number(n) || 0) || 1));
const VALID_TYPES = new Set(["monster", "item", "biome", "tile"]);

/**
 * Build a bulk-generation queue.
 * @param {object} o
 * @param {(type:string, opts:object)=>Promise<any>} o.runGen  run ONE generation (auto-saves); resolves the
 *        created object (truthy = success) or a falsy value (counted as a failure).
 * @param {(c:number)=>void} [o.onConcurrency]  called when concurrency changes (the app raises the monster cap).
 * @param {number} [o.concurrency]  initial parallelism (clamped 1..MAX_CONCURRENCY).
 * @param {()=>number} [o.now]  clock (injectable for tests).
 * @returns {{enqueue,pause,resume,clear,setConcurrency,status}}
 */
export function makeGenQueue({ runGen, onConcurrency, concurrency = DEFAULT_CONCURRENCY, now = () => Date.now() } = {}) {
  if (typeof runGen !== "function") throw new TypeError("makeGenQueue: runGen must be a function");
  const pending = [];           // queued jobs: { id, type, opts }
  let running = 0, done = 0, failed = 0, paused = false, seq = 0, failStreak = 0, lastError = null;
  let endless = null;           // { type, opts } while endless mode is on (keeps producing jobs)
  let conc = clampConc(concurrency);
  const recent = [];            // [{ id, type, ok, name, at, error }]
  const applyConc = (c) => { try { onConcurrency && onConcurrency(c); } catch { /* wiring optional */ } };
  applyConc(conc);

  function record(job, ok, result, err) {
    if (ok) { done++; failStreak = 0; }
    else { failed++; failStreak++; lastError = (err && err.message) || (err ? String(err) : "generation returned null (AI off / rejected / failed)"); }
    recent.push({ id: job.id, type: job.type, ok: !!ok, name: ok ? genName(job.type, result) : null, at: now(), error: ok ? null : lastError });
    if (recent.length > RECENT_CAP) recent.shift();
    // Safety: a long endless/large run hitting a persistent error (AI disabled, bad key, rate-limit wall)
    // would otherwise burn the whole target as failures. Auto-pause so the operator can fix + resume.
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
        .then(() => { running--; pump(); }); // one slot freed → try to refill (paced by gen completion, no busy-loop)
    }
  }

  return {
    /** Add `count` jobs of `type` (count = a number, or "endless"/Infinity for an open-ended run). */
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
    pause() { paused = true; },                               // stop launching new jobs; in-flight ones finish
    resume() { paused = false; failStreak = 0; pump(); },
    clear() { pending.length = 0; endless = null; },          // drop all pending + stop endless; in-flight finish naturally
    setConcurrency(n) { conc = clampConc(n); applyConc(conc); pump(); return conc; },
    /** Live snapshot for the admin display. */
    status() {
      return {
        running, done, failed, paused, concurrency: conc, maxConcurrency: MAX_CONCURRENCY,
        pending: pending.length, endless: !!endless, endlessType: endless ? endless.type : null,
        failStreak, lastError, recent: recent.slice(-12).reverse(),
      };
    },
  };
}

// A readable label for a completed generation (best-effort across the 4 types' field names).
function genName(type, r) {
  if (!r || typeof r !== "object") return null;
  return r.typeName || r.name || (r.id != null ? `${type} #${r.id}` : type);
}

export { DEFAULT_CONCURRENCY, MAX_CONCURRENCY, FAIL_STREAK_PAUSE };
