const GEN_TRACE_MAX = 24;
const genTrace = [];

export const clip = (s, n = 4000) => {
  const t = typeof s === "string" ? s : JSON.stringify(s);
  return t == null ? t : (t.length > n ? t.slice(0, n) + `… [+${t.length - n} chars]` : t);
};

export function recordGenTrace(e) {
  genTrace.push(e);
  while (genTrace.length > GEN_TRACE_MAX) genTrace.shift();
}

export function genTraceSnapshot() { return genTrace.slice(); }

const JUDGE_TRACE_MAX = 30;
const judgeTrace = [];
export function recordJudgeTrace(e) {
  judgeTrace.push(e);
  while (judgeTrace.length > JUDGE_TRACE_MAX) judgeTrace.shift();
}
export function judgeTraceSnapshot() { return judgeTrace.slice(); }

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
