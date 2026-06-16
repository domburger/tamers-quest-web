// Shared generation telemetry (TQ-331; TQ-404). Captures every gen STAGE's model INPUTS (system +
// user prompt, model id) and its raw OUTPUT (or error) so an operator can review exactly what each
// agent was asked and returned when a generation comes out wrong (missing name, off-brief visual…).
// In-memory ring buffer, newest last, admin-only via genTraceSnapshot(). Strings are clipped so the
// buffer can't grow unbounded.
//
// Originally lived in genStages.js (monster pipeline only). Lifted here (TQ-404) so the item / biome /
// tile pipelines — which use openaiChatJson, not the LangChain structuredInvoke — record into the SAME
// buffer and show up in the admin "Generation trace" panel exactly like monster stages.

const GEN_TRACE_MAX = 24;
const genTrace = [];

// Clip a value to a max length for the trace buffer (objects → JSON). Keeps the ring buffer bounded.
export const clip = (s, n = 4000) => {
  const t = typeof s === "string" ? s : JSON.stringify(s);
  return t == null ? t : (t.length > n ? t.slice(0, n) + `… [+${t.length - n} chars]` : t);
};

export function recordGenTrace(e) {
  genTrace.push(e);
  while (genTrace.length > GEN_TRACE_MAX) genTrace.shift();
}

export function genTraceSnapshot() { return genTrace.slice(); }

// ── Fight-judge telemetry (TQ-491) ─────────────────────────────────────────────────────────────
// The combat / capture judge calls (server/ai.js) are a SEPARATE concern from asset generation, and
// they fire FAR more often (once per fight turn) — so they get their OWN ring buffer instead of the
// gen one, otherwise a single fight would evict every gen trace. Same entry shape (stage, model, ok,
// ms, system, user, output|error) so the admin "Fight-judge trace" panel reuses the gen-trace UI.
const JUDGE_TRACE_MAX = 30;
const judgeTrace = [];
export function recordJudgeTrace(e) {
  judgeTrace.push(e);
  while (judgeTrace.length > JUDGE_TRACE_MAX) judgeTrace.shift();
}
export function judgeTraceSnapshot() { return judgeTrace.slice(); }

// Wrap a plain chat call (`chat(system, user, model, temperature)` → parsed JSON) so it records a
// trace entry under `stage`, mirroring structuredInvoke's monster-stage telemetry. The chat fn's
// signature is unchanged (so test `deps.chat` overrides keep working). Re-throws on error after
// recording it. Used by the item / biome / tile pipelines.
export async function tracedChatJson(chat, { stage, system, user, model, temperature }) {
  const startedAt = Date.now();
  try {
    const out = await chat(system, user, model, temperature);
    recordGenTrace({ stage, model, ok: true, ms: Date.now() - startedAt, system: clip(system), user: clip(user), output: clip(out, 8000) });
    return out;
  } catch (e) {
    recordGenTrace({ stage, model, ok: false, ms: Date.now() - startedAt, system: clip(system), user: clip(user), error: clip(String((e && e.message) || e), 1000) });
    throw e;
  }
}
