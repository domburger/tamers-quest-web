// TQ-403: live API cost / token-usage tracking. In-memory running totals (reset on restart, like
// aiMetrics.js) of OpenAI token usage across BOTH AI paths — the combat/capture judges (server/
// openai.js) and the generation pipeline (server/genStages.js LangChain callback) — broken down per
// model, with a best-effort USD estimate. TOKEN COUNTS ARE EXACT (from the API's usage field); the
// dollar figure is an ESTIMATE derived from the editable rate table below (the app's gpt-5.x models'
// real prices may differ — update PRICE_PER_MTOK to match your billing). /api/admin/stats surfaces it.

// Approximate USD per 1,000,000 tokens, {in, out}. ESTIMATES — edit to your actual rates. A model not
// listed here still has its tokens counted; it just contributes $0 to the estimate (priced:false).
const PRICE_PER_MTOK = {
  "gpt-5.4": { in: 2.5, out: 10 },
  "gpt-5.4-mini": { in: 0.15, out: 0.6 },
  "gpt-5.5": { in: 5, out: 20 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
};

const byModel = new Map(); // model -> { calls, promptTokens, completionTokens }
let calls = 0, promptTokens = 0, completionTokens = 0;

// Record one API call's token usage. Defensive: missing/garbage fields count as 0 (never throws — a
// telemetry hook must not break a real generation or combat turn).
export function recordUsage({ model = "?", promptTokens: pt = 0, completionTokens: ct = 0 } = {}) {
  const p = Math.max(0, Math.floor(Number(pt) || 0)), c = Math.max(0, Math.floor(Number(ct) || 0));
  calls++; promptTokens += p; completionTokens += c;
  const m = byModel.get(model) || { calls: 0, promptTokens: 0, completionTokens: 0 };
  m.calls++; m.promptTokens += p; m.completionTokens += c;
  byModel.set(model, m);
}

function usd(model, pt, ct) {
  const r = PRICE_PER_MTOK[model];
  if (!r) return 0;
  return (pt / 1e6) * r.in + (ct / 1e6) * r.out;
}

// Snapshot for the admin panel: grand totals + a per-model breakdown (priciest first). `estUsd` is the
// editable-rate estimate; `priced` flags whether a rate existed for that model.
export function aiCostSnapshot() {
  const models = [...byModel.entries()].map(([model, m]) => ({
    model,
    calls: m.calls,
    promptTokens: m.promptTokens,
    completionTokens: m.completionTokens,
    estUsd: +usd(model, m.promptTokens, m.completionTokens).toFixed(4),
    priced: Object.prototype.hasOwnProperty.call(PRICE_PER_MTOK, model),
  })).sort((a, b) => b.estUsd - a.estUsd || b.calls - a.calls);
  const estUsd = +models.reduce((s, x) => s + x.estUsd, 0).toFixed(4);
  return { calls, promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, estUsd, byModel: models };
}

export function resetAiCost() { byModel.clear(); calls = 0; promptTokens = 0; completionTokens = 0; }
