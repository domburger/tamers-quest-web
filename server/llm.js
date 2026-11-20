import { recordUsage } from "./aiCost.js";

export const PROVIDERS = {
  openai: {
    id: "openai", label: "OpenAI", env: ["OPENAI_API_KEY"], kind: "openai-compat",
    url: "https://api.openai.com/v1/chat/completions", modelsUrl: "https://api.openai.com/v1/models",
    tokenParam: "max_completion_tokens", // gpt-5.x reject the legacy max_tokens param.
    jsonSchema: true, strict: true,
    defaults: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5-chat-latest", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
    modelFilter: (id) => /^(gpt-|o\d)/.test(id) && !/(audio|realtime|transcribe|tts|search|image|embedding|moderation|codex|instruct|computer)/.test(id),
  },
  anthropic: {
    id: "anthropic", label: "Anthropic Claude", env: ["ANTHROPIC_API_KEY"], kind: "anthropic",
    defaults: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
    modelFilter: (id) => /^claude-/.test(id),
  },
  gemini: {
    id: "gemini", label: "Google Gemini", env: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], kind: "openai-compat",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    modelsUrl: "https://generativelanguage.googleapis.com/v1beta/openai/models",
    tokenParam: "max_tokens", jsonSchema: true, strict: false,
    defaults: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-2.5-pro", "gemini-2.5-flash"],
    modelFilter: (id) => /^gemini-/.test(id) && !/(embedding|tts|image|live|audio|native|aqa|exp)/.test(id),
  },
  deepseek: {
    id: "deepseek", label: "DeepSeek", env: ["DEEPSEEK_API_KEY"], kind: "openai-compat",
    url: "https://api.deepseek.com/chat/completions", modelsUrl: "https://api.deepseek.com/models",
    tokenParam: "max_tokens", jsonSchema: false, strict: false,
    defaults: ["deepseek-flash", "deepseek-chat", "deepseek-reasoner"],
    modelFilter: () => true,
  },
  groq: {
    id: "groq", label: "Groq (Llama & open models)", env: ["GROQ_API_KEY"], kind: "openai-compat",
    url: "https://api.groq.com/openai/v1/chat/completions", modelsUrl: "https://api.groq.com/openai/v1/models",
    tokenParam: "max_tokens", jsonSchema: true, strict: false,
    defaults: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "meta-llama/llama-4-scout-17b-16e-instruct", "openai/gpt-oss-120b", "moonshotai/kimi-k2-instruct"],
    modelFilter: (id) => !/(whisper|tts|guard|playai|orpheus|prompt-guard|safeguard)/i.test(id),
  },
};
export const PROVIDER_IDS = Object.keys(PROVIDERS);
for (const id of PROVIDER_IDS) PROVIDERS[id].id = id;

export function splitModel(id) {
  const s = String(id || "").trim();
  const m = /^([a-z]+):(.+)$/i.exec(s);
  if (m && PROVIDERS[m[1].toLowerCase()]) return { provider: m[1].toLowerCase(), model: m[2].trim() };
  return { provider: inferProvider(s), model: s };
}
export function inferProvider(model) {
  const m = String(model || "").toLowerCase();
  if (/^claude-/.test(m)) return "anthropic";
  if (/^(gemini-|models\/gemini)/.test(m)) return "gemini";
  if (/^deepseek-/.test(m)) return "deepseek";
  if (/^(llama|meta-llama\/|openai\/gpt-oss|moonshotai\/|qwen|groq\/|compound|gemma|mistral|mixtral|allam)/.test(m)) return "groq";
  return "openai";
}

export function providerKey(provider) {
  const p = PROVIDERS[provider];
  if (!p) return "";
  for (const e of p.env) if (process.env[e]) return process.env[e];
  return "";
}
export function providerEnabled(provider) { return !!providerKey(provider); }
export function enabledProviders() { return PROVIDER_IDS.filter(providerEnabled); }
export function aiEnabled() { return enabledProviders().length > 0; }

const DEGRADE_MS = 10 * 60 * 1000;
const degraded = new Map();
export function providerHealthy(provider) { const until = degraded.get(provider); return providerEnabled(provider) && !(until && until > Date.now()); }
export function healthyProviders() { return PROVIDER_IDS.filter(providerHealthy); }
export function degradeReason(status, errText) {
  const t = String(errText || "");
  if (status === 401 || status === 403) return "key rejected";
  if (status === 402) return "billing";
  if (status === 429 && /credit|quota|billing|insufficient|exceeded your current/i.test(t)) return "no credits / quota exhausted";
  return null;
}
function markDegraded(provider, reason) {
  degraded.set(provider, Date.now() + DEGRADE_MS);
  const alt = healthyProviders()[0];
  console.warn(`[llm] ${PROVIDERS[provider].label}: ${reason} — ${alt ? `failing over to ${PROVIDERS[alt].label}` : "NO other provider configured (AI degraded)"} for ${DEGRADE_MS / 60000} min`);
}

export function providerStatus() {
  return PROVIDER_IDS.map((id) => {
    const p = PROVIDERS[id];
    const until = degraded.get(id);
    const isDegraded = providerEnabled(id) && !!until && until > Date.now();
    return { id, label: p.label, enabled: providerEnabled(id), degraded: isDegraded, degradedUntil: isDegraded ? until : null, env: p.env.join(" or "), defaults: p.defaults };
  });
}

export function modelOptions() {
  const live = enabledProviders();
  const ids = live.length ? live : PROVIDER_IDS;
  const out = [];
  for (const id of ids) for (const m of PROVIDERS[id].defaults) out.push(qualify(id, m));
  return out;
}
export function qualify(provider, model) { return inferProvider(model) === provider ? model : `${provider}:${model}`; }

const rerouted = new Set();
export function resolveModel(id) {
  const { provider, model } = splitModel(id);
  if (providerHealthy(provider)) return { provider, model, requested: id, substituted: false };
  const alt = healthyProviders()[0];
  if (!alt) return { provider, model, requested: id, substituted: false };
  const sub = PROVIDERS[alt].defaults[0];
  const why = providerEnabled(provider) ? "degraded" : "no API key";
  const logKey = `${id}→${alt}`;
  if (!rerouted.has(logKey)) { rerouted.add(logKey); console.warn(`[llm] ${why} for ${provider} (model "${id}") — routing to ${alt}:${sub}`); }
  return { provider: alt, model: sub, requested: id, substituted: true };
}

// Strict modes 400 on these keywords; normalizers must re-enforce the bounds.
const STRICT_DROP = new Set([
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minItems", "maxItems", "minLength", "maxLength", "pattern", "format",
  "default", "uniqueItems", "minProperties", "maxProperties",
]);
export function toStrictSchema(node) {
  if (Array.isArray(node)) return node.map(toStrictSchema);
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (STRICT_DROP.has(k)) continue;
    out[k] = toStrictSchema(v);
  }
  if (out.type === "object" && out.properties && typeof out.properties === "object") {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties);
  }
  return out;
}
function schemaInstruction(schema, name) {
  return `\n\nRespond with ONLY a single JSON object${name ? ` (${name})` : ""} — no prose, no markdown fences — that matches this JSON Schema exactly (every listed property is required, no extra properties):\n${JSON.stringify(schema)}`;
}

const noSampling = new Set();
const noJsonSchema = new Set();
const isSamplingError = (t) => /temperature|top_p/i.test(t) && /unsupported|does not support|not support|invalid|not allowed/i.test(t);
const isSchemaError = (t) => /response_format|json_schema|schema/i.test(t) && !/temperature|top_p/i.test(t);

export function parseJsonLoose(text) {
  const s = String(text ?? "").trim();
  if (!s) throw new Error("empty response");
  try { return JSON.parse(s); } catch {}
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch {} }
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
  throw new Error("response is not JSON");
}

async function fetchJson(url, { method = "POST", headers = {}, body, timeoutMs }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body: body == null ? undefined : JSON.stringify(body), signal: ctrl.signal });
    if (res.ok) return { ok: true, data: await res.json() };
    return { ok: false, status: res.status, errText: typeof res.text === "function" ? await res.text() : "" };
  } catch (e) {
    throw new Error(e.name === "AbortError" ? `LLM request timed out after ${timeoutMs}ms` : e.message);
  } finally { clearTimeout(timer); }
}

// <PROVIDER>_BASE_URL (built dynamically) is how QA points at tools/mock-llm.mjs.
export function providerUrls(p) {
  const base = process.env[`${p.id.toUpperCase()}_BASE_URL`];
  if (!base) return { url: p.url, modelsUrl: p.modelsUrl };
  const b = String(base).replace(/\/+$/, "");
  return { url: `${b}/chat/completions`, modelsUrl: `${b}/models` };
}

async function openaiCompatChat(p, { model, system, user, temperature, topP, maxTokens, timeoutMs, schema, schemaName }) {
  const key = `${p.id}/${model}`;
  const useSchemaMode = !!schema && p.jsonSchema && !noJsonSchema.has(key);
  const strictSchema = schema ? toStrictSchema(schema) : null;
  const build = (withSampling, schemaMode) => {
    const sys = schemaMode || !schema ? system : system + schemaInstruction(strictSchema, schemaName);
    const body = {
      model,
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      response_format: schemaMode
        ? { type: "json_schema", json_schema: { name: schemaName || "result", schema: strictSchema, ...(p.strict ? { strict: true } : {}) } }
        : { type: "json_object" },
    };
    if (Number.isFinite(maxTokens)) body[p.tokenParam] = maxTokens;
    if (withSampling) {
      if (Number.isFinite(temperature)) body.temperature = temperature;
      if (Number.isFinite(topP) && topP !== 1) body.top_p = topP;
    }
    return body;
  };
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${providerKey(p.id)}` };
  const { url } = providerUrls(p);
  const once = (body) => fetchJson(url, { headers, body, timeoutMs });

  let sampling = (Number.isFinite(temperature) || (Number.isFinite(topP) && topP !== 1)) && !noSampling.has(key);
  let schemaMode = useSchemaMode;
  let r = await once(build(sampling, schemaMode));
  for (let retry = 0; !r.ok && retry < 2; retry++) {
    const t = r.errText || "";
    if (sampling && isSamplingError(t)) { noSampling.add(key); sampling = false; }
    else if (schemaMode && (r.status === 400 || r.status === 422) && isSchemaError(t)) { noJsonSchema.add(key); schemaMode = false; }
    else break;
    r = await once(build(sampling, schemaMode));
  }
  if (!r.ok) { const err = new Error(`${p.label} ${r.status}: ${(r.errText || "").slice(0, 200)}`); err.status = r.status; err.errText = r.errText; err.provider = p.id; throw err; }
  const u = (r.data && r.data.usage) || {};
  recordUsage({ model: qualify(p.id, model), promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens });
  const msg = r.data.choices?.[0]?.message;
  if (msg?.refusal) throw new Error(`${p.label}: refused (${String(msg.refusal).slice(0, 120)})`);
  const content = msg?.content;
  if (!content) throw new Error(`${p.label}: empty response`);
  return parseJsonLoose(content);
}

let anthropicClient = null;
async function getAnthropic() {
  if (anthropicClient) return anthropicClient;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  anthropicClient = new Anthropic({ apiKey: providerKey("anthropic"), maxRetries: 1 });
  return anthropicClient;
}
const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/;
const NO_EFFORT = /^claude-(.*-(3|4-[0-5])(-|$)|haiku-4-5)/;
async function anthropicChat({ model, system, user, maxTokens, timeoutMs, schema, schemaName }) {
  const client = await getAnthropic();
  const strictSchema = schema ? toStrictSchema(schema) : null;
  // Thinking counts toward max_tokens: keep headroom over the caller's JSON cap.
  const max_tokens = Math.max(Number.isFinite(maxTokens) ? maxTokens * 4 : 0, 4096);
  const output_config = {};
  if (!NO_EFFORT.test(model)) output_config.effort = "low";
  if (strictSchema) output_config.format = { type: "json_schema", schema: strictSchema };
  const sys = schema ? system : system + "\n\nRespond with ONLY a single JSON object — no prose, no markdown fences.";
  const params = {
    model, max_tokens, system: sys,
    messages: [{ role: "user", content: user }],
    ...(Object.keys(output_config).length ? { output_config } : {}),
  };
  const opts = { timeout: timeoutMs, maxRetries: 1 };
  const res = FALLBACK_MODELS.test(model)
    ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }, opts)
    : await client.messages.create(params, opts);
  const u = res.usage || {};
  recordUsage({ model, promptTokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), completionTokens: u.output_tokens });
  if (res.stop_reason === "refusal") throw new Error(`Anthropic: refused (${res.stop_details?.category || "policy"})`);
  const text = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  if (!text) throw new Error("Anthropic: empty response");
  return parseJsonLoose(text);
}

export async function chatJson(o) {
  const call = ({ provider, model }) => {
    const p = PROVIDERS[provider];
    if (!providerKey(provider)) throw new Error(`No API key configured for ${p.label} (${p.env.join(" / ")})`);
    const req = { ...o, model, timeoutMs: o.timeoutMs || 30000 };
    return p.kind === "anthropic" ? anthropicChat(req) : openaiCompatChat(p, req);
  };
  const first = resolveModel(o.model);
  try {
    return await call(first);
  } catch (e) {
    const reason = degradeReason(e && e.status, (e && (e.errText || e.message)) || "");
    if (!reason) throw e;
    markDegraded(first.provider, reason);
    const second = resolveModel(o.model);
    if (second.provider === first.provider) throw e;
    return call(second);
  }
}

const modelCache = new Map();
const MODEL_TTL_MS = 10 * 60 * 1000;
export async function listModels(provider, { refresh = false, timeoutMs = 8000 } = {}) {
  const p = PROVIDERS[provider];
  if (!p || !providerEnabled(provider)) return { provider, ids: [], error: p ? "no key" : "unknown provider" };
  const hit = modelCache.get(provider);
  if (!refresh && hit && Date.now() - hit.at < MODEL_TTL_MS) return { provider, ids: hit.ids, cached: true };
  try {
    let ids = [];
    if (p.kind === "anthropic") {
      const client = await getAnthropic();
      for await (const m of client.models.list({ limit: 100 }, { timeout: timeoutMs })) ids.push(m.id);
    } else {
      const r = await fetchJson(providerUrls(p).modelsUrl, { method: "GET", headers: { Authorization: `Bearer ${providerKey(provider)}` }, timeoutMs });
      if (!r.ok) throw new Error(`${r.status} ${(r.errText || "").slice(0, 120)}`);
      ids = (r.data?.data || r.data?.models || []).map((m) => String(m.id || m.name || "").replace(/^models\//, "")).filter(Boolean);
    }
    ids = [...new Set(ids.filter(p.modelFilter))].sort();
    modelCache.set(provider, { at: Date.now(), ids });
    return { provider, ids };
  } catch (e) {
    return { provider, ids: hit ? hit.ids : [], error: String(e && e.message || e).slice(0, 200) };
  }
}
export async function listAllModels(opts) {
  const out = {};
  await Promise.all(enabledProviders().map(async (id) => { out[id] = await listModels(id, opts); }));
  return out;
}

export function _resetLlmState() { noSampling.clear(); noJsonSchema.clear(); rerouted.clear(); modelCache.clear(); degraded.clear(); anthropicClient = null; }
