// Shared OpenAI Chat Completions helper, compatible with CURRENT models. Two param drifts the
// older inline calls hit, which made newer models 400 at runtime (so they were "available" in
// the admin model list but unusable):
//   1. gpt-5.x reject the legacy `max_tokens` → they need `max_completion_tokens` (gpt-4.x
//      accept it too), so we always send the modern field.
//   2. flagship gpt-5.x lock `temperature`/`top_p` to the default (1) and 400 a custom value,
//      while mini/nano/chat tiers + the 4.x family allow custom values. We send the requested
//      sampling values and RETRY ONCE without them if the model rejects them.
// Result: any current chat model "just works" for combat + generation. Returns the parsed JSON
// object from the model's (json_object) response, or throws (callers fall back to the engine /
// return null). The success path reads res.json() and the error path res.text() — matching the
// existing test mocks (which supply json() on ok and may leave text() empty).

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

// Models observed to reject custom temperature/top_p (flagship gpt-5.x). Once a model 400s on
// sampling, we remember it and skip sampling up front for subsequent calls — so a locked model
// costs ONE request per turn after the first probe, not a fail+retry every time.
const noSampling = new Set();

function isSamplingError(text) {
  return /temperature|top_p/i.test(text) && /unsupported|does not support|not support/i.test(text);
}

/**
 * @param {object} o
 * @param {string} o.model   OpenAI chat model id
 * @param {string} o.system  system prompt
 * @param {string} o.user    user prompt
 * @param {number} [o.temperature]  sampling temperature (dropped on a sampling-400 retry)
 * @param {number} [o.topP]         nucleus sampling (only sent when ≠ 1; dropped on retry)
 * @param {number} [o.maxTokens]    response cap → sent as max_completion_tokens
 * @param {number} [o.timeoutMs]    abort after this long (default 30s)
 */
export async function openaiChatJson({ model, system, user, temperature, topP, maxTokens, timeoutMs = 30000 }) {
  const base = {
    model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    response_format: { type: "json_object" },
  };
  if (Number.isFinite(maxTokens)) base.max_completion_tokens = maxTokens;
  const sampling = {};
  if (Number.isFinite(temperature)) sampling.temperature = temperature;
  if (Number.isFinite(topP) && topP !== 1) sampling.top_p = topP;

  const once = async (body) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (res.ok) return { ok: true, data: await res.json() };
      return { ok: false, status: res.status, errText: await res.text() };
    } catch (e) {
      throw new Error(e.name === "AbortError" ? `OpenAI timed out after ${timeoutMs}ms` : e.message);
    } finally { clearTimeout(timer); }
  };

  const useSampling = Object.keys(sampling).length > 0 && !noSampling.has(model);
  let r = await once(useSampling ? { ...base, ...sampling } : base);
  if (!r.ok && useSampling && isSamplingError(r.errText || "")) {
    noSampling.add(model); // remember → future calls for this model skip sampling (single request)
    r = await once(base);
  }
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(r.errText || "").slice(0, 200)}`);
  const content = r.data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI: empty response");
  return JSON.parse(content);
}
