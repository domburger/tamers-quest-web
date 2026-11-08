// TQ-405: multi-provider LLM router — routing, key gating / re-routing, and the OpenAI-compatible
// wire path (schema mode, json_object fallback, locked-sampling retry) with a mocked fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitModel, inferProvider, providerOf, qualify, resolveModel, enabledProviders, aiEnabled,
  modelOptions, providerStatus, toStrictSchema, parseJsonLoose, chatJson, listModels, _resetLlmState,
} from "./llm.js";

const KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "DEEPSEEK_API_KEY", "GROQ_API_KEY"];
function withEnv(env, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  const origFetch = global.fetch;
  _resetLlmState();
  const done = () => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } global.fetch = origFetch; _resetLlmState(); };
  return Promise.resolve().then(fn).finally(done);
}
const okChat = (content, usage = { prompt_tokens: 10, completion_tokens: 5 }) => ({ ok: true, json: async () => ({ choices: [{ message: { content } }], usage }) });
const bad = (status, text) => ({ ok: false, status, text: async () => text });

test("inferProvider / splitModel: model family → provider; explicit prefix wins", () => {
  assert.equal(inferProvider("gpt-5.4-mini"), "openai");
  assert.equal(inferProvider("claude-opus-5-5"), "anthropic");
  assert.equal(inferProvider("gemini-2.5-flash"), "gemini");
  assert.equal(inferProvider("deepseek-chat"), "deepseek");
  assert.equal(inferProvider("llama-3.3-70b-versatile"), "groq");
  assert.equal(inferProvider("meta-llama/llama-4-scout-17b-16e-instruct"), "groq");
  assert.equal(inferProvider("openai/gpt-oss-120b"), "groq");
  assert.deepEqual(splitModel("groq:gemma2-9b-it"), { provider: "groq", model: "gemma2-9b-it" });
  assert.deepEqual(splitModel("anthropic:claude-haiku-5-5"), { provider: "anthropic", model: "claude-haiku-5-5" });
  assert.equal(providerOf("nonsense:foo"), "openai", "unknown prefix is not a provider → treated as a plain (openai) id");
  assert.equal(qualify("groq", "playai-tts-7b"), "groq:playai-tts-7b", "a family the heuristic would not route to groq gets the prefix");
  assert.equal(qualify("groq", "llama-3.1-8b-instant"), "llama-3.1-8b-instant");
});

test("key gating: enabledProviders / aiEnabled / providerStatus follow the env; GOOGLE_API_KEY also enables gemini", () =>
  withEnv({}, async () => {
    assert.deepEqual(enabledProviders(), []);
    assert.equal(aiEnabled(), false);
    process.env.GROQ_API_KEY = "g"; process.env.GOOGLE_API_KEY = "x";
    assert.deepEqual(enabledProviders(), ["gemini", "groq"]);
    assert.equal(aiEnabled(), true);
    const st = providerStatus();
    assert.equal(st.find((p) => p.id === "gemini").enabled, true);
    assert.equal(st.find((p) => p.id === "openai").enabled, false);
    assert.ok(st.every((p) => typeof p.env === "string" && Array.isArray(p.defaults) && p.defaults.length));
  }));

test("modelOptions: enabled providers' defaults (qualified when needed); all providers when none configured", () =>
  withEnv({}, async () => {
    const all = modelOptions();
    assert.ok(all.includes("gpt-5.5") && all.includes("claude-opus-5-5") && all.includes("deepseek-chat"), "nothing configured → every provider's picks");
    process.env.ANTHROPIC_API_KEY = "a";
    const only = modelOptions();
    assert.ok(only.every((m) => m.startsWith("claude-")), "only the configured provider");
  }));

test("resolveModel: re-routes a model whose provider has no key to the first enabled provider's default", () =>
  withEnv({ GROQ_API_KEY: "g" }, async () => {
    const r = resolveModel("gpt-5.4-mini");
    assert.equal(r.provider, "groq");
    assert.equal(r.model, "llama-3.3-70b-versatile");
    assert.equal(r.substituted, true);
    const same = resolveModel("groq:llama-3.1-8b-instant");
    assert.deepEqual([same.provider, same.model, same.substituted], ["groq", "llama-3.1-8b-instant", false]);
  }));

test("toStrictSchema: drops unsupported keywords, forces additionalProperties:false + required on every object", () => {
  const s = toStrictSchema({ type: "object", properties: { a: { type: "integer", minimum: 1 }, b: { type: "array", minItems: 2, items: { type: "object", properties: { c: { type: "string", maxLength: 3 } } } } } });
  assert.deepEqual(s, { type: "object", additionalProperties: false, required: ["a", "b"], properties: { a: { type: "integer" }, b: { type: "array", items: { type: "object", additionalProperties: false, required: ["c"], properties: { c: { type: "string" } } } } } });
});

test("parseJsonLoose: plain, fenced, and prose-wrapped JSON", () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLoose('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(parseJsonLoose('Sure! Here it is: {"a":3} hope that helps'), { a: 3 });
  assert.throws(() => parseJsonLoose("no json here"));
  assert.throws(() => parseJsonLoose(""));
});

test("chatJson (openai-compat): schema → json_schema strict on OpenAI; Groq endpoint + bearer key; usage recorded", () =>
  withEnv({ OPENAI_API_KEY: "sk-o", GROQ_API_KEY: "gsk" }, async () => {
    const calls = [];
    global.fetch = async (url, opts) => { calls.push({ url, headers: opts.headers, body: JSON.parse(opts.body) }); return okChat('{"name":"Ember"}'); };
    const schema = { type: "object", properties: { name: { type: "string", maxLength: 20 } } };
    const r1 = await chatJson({ model: "gpt-5.4-mini", system: "s", user: "u", temperature: 0.9, maxTokens: 300, schema, schemaName: "Idea" });
    assert.deepEqual(r1, { name: "Ember" });
    assert.ok(calls[0].url.startsWith("https://api.openai.com/"));
    assert.equal(calls[0].headers.Authorization, "Bearer sk-o");
    assert.equal(calls[0].body.response_format.type, "json_schema");
    assert.equal(calls[0].body.response_format.json_schema.name, "Idea");
    assert.equal(calls[0].body.response_format.json_schema.strict, true);
    assert.deepEqual(calls[0].body.response_format.json_schema.schema.required, ["name"]);
    assert.equal(calls[0].body.max_completion_tokens, 300);
    const r2 = await chatJson({ model: "llama-3.3-70b-versatile", system: "s", user: "u", maxTokens: 300 });
    assert.deepEqual(r2, { name: "Ember" });
    assert.ok(calls[1].url.startsWith("https://api.groq.com/openai/v1/"));
    assert.equal(calls[1].headers.Authorization, "Bearer gsk");
    assert.equal(calls[1].body.response_format.type, "json_object", "no schema → json_object");
    assert.equal(calls[1].body.max_tokens, 300, "groq takes the standard max_tokens");
  }));

test("chatJson (openai-compat): a provider that rejects json_schema falls back to json_object + the schema inlined in the prompt, and remembers it", () =>
  withEnv({ GEMINI_API_KEY: "gm" }, async () => {
    const bodies = [];
    global.fetch = async (_u, opts) => {
      const b = JSON.parse(opts.body); bodies.push(b);
      if (b.response_format.type === "json_schema") return bad(400, "Invalid JSON payload: response_format.json_schema not supported");
      return okChat('{"ok":true}');
    };
    const schema = { type: "object", properties: { ok: { type: "boolean" } } };
    const r = await chatJson({ model: "gemini-2.5-flash", system: "sys", user: "u", schema, schemaName: "T" });
    assert.deepEqual(r, { ok: true });
    assert.equal(bodies.length, 2);
    assert.equal(bodies[1].response_format.type, "json_object");
    assert.match(bodies[1].messages[0].content, /JSON Schema/);
    assert.match(bodies[1].messages[0].content, /"additionalProperties":false/);
    bodies.length = 0;
    await chatJson({ model: "gemini-2.5-flash", system: "sys", user: "u", schema, schemaName: "T" });
    assert.equal(bodies.length, 1, "remembered → json_object up front");
  }));

test("chatJson (openai-compat): DeepSeek never gets json_schema (schema inlined); locked sampling retried + remembered", () =>
  withEnv({ DEEPSEEK_API_KEY: "ds" }, async () => {
    const bodies = [];
    global.fetch = async (_u, opts) => {
      const b = JSON.parse(opts.body); bodies.push(b);
      if ("temperature" in b) return bad(400, "temperature is not supported with this model");
      return okChat('{"v":1}');
    };
    const r = await chatJson({ model: "deepseek-chat", system: "s", user: "u", temperature: 0.7, schema: { type: "object", properties: { v: { type: "integer" } } } });
    assert.deepEqual(r, { v: 1 });
    assert.equal(bodies[0].response_format.type, "json_object");
    assert.match(bodies[0].messages[0].content, /JSON Schema/);
    assert.equal(bodies.length, 2, "temperature 400 → one retry without sampling");
    assert.ok(!("temperature" in bodies[1]));
    bodies.length = 0;
    await chatJson({ model: "deepseek-chat", system: "s", user: "u", temperature: 0.7 });
    assert.equal(bodies.length, 1);
  }));

test("chatJson: no provider configured → clear error; unrelated 4xx surfaces the provider + status", () =>
  withEnv({}, async () => {
    await assert.rejects(() => chatJson({ model: "gpt-5.5", system: "s", user: "u" }), /No API key configured for OpenAI/);
    process.env.OPENAI_API_KEY = "k";
    global.fetch = async () => bad(429, "rate limited");
    await assert.rejects(() => chatJson({ model: "gpt-5.5", system: "s", user: "u" }), /OpenAI 429: rate limited/);
  }));

test("listModels: filters to chat models, strips Gemini's models/ prefix, caches; no key → empty", () =>
  withEnv({ GEMINI_API_KEY: "gm", OPENAI_API_KEY: "k" }, async () => {
    let n = 0;
    global.fetch = async (url) => {
      n++;
      if (url.includes("googleapis")) return { ok: true, json: async () => ({ data: [{ id: "models/gemini-2.5-flash" }, { id: "models/gemini-embedding-001" }, { id: "models/gemini-2.5-pro" }] }) };
      return { ok: true, json: async () => ({ data: [{ id: "gpt-5.5" }, { id: "gpt-4o-realtime-preview" }, { id: "text-embedding-3-small" }, { id: "o3" }, { id: "whisper-1" }] }) };
    };
    const g = await listModels("gemini");
    assert.deepEqual(g.ids, ["gemini-2.5-flash", "gemini-2.5-pro"]);
    const o = await listModels("openai");
    assert.deepEqual(o.ids, ["gpt-5.5", "o3"]);
    const again = await listModels("openai");
    assert.equal(again.cached, true);
    assert.equal(n, 2, "second openai call served from cache");
    const none = await listModels("groq");
    assert.deepEqual(none.ids, []);
  }));

test("providerUrls: <PROVIDER>_BASE_URL overrides the chat + models endpoints (gateway / local mock)", async () => {
  const { providerUrls, PROVIDERS } = await import("./llm.js");
  const saved = process.env.OPENAI_BASE_URL;
  try {
    delete process.env.OPENAI_BASE_URL;
    assert.equal(providerUrls(PROVIDERS.openai).url, "https://api.openai.com/v1/chat/completions");
    process.env.OPENAI_BASE_URL = "http://localhost:8099/v1/";
    assert.deepEqual(providerUrls(PROVIDERS.openai), { url: "http://localhost:8099/v1/chat/completions", modelsUrl: "http://localhost:8099/v1/models" });
    assert.equal(providerUrls(PROVIDERS.groq).url, "https://api.groq.com/openai/v1/chat/completions", "other providers unaffected");
  } finally { if (saved === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = saved; }
});

test("chatJson honours OPENAI_BASE_URL for the request target", () =>
  withEnv({ OPENAI_API_KEY: "k" }, async () => {
    process.env.OPENAI_BASE_URL = "http://localhost:8099/v1";
    try {
      let hit = "";
      global.fetch = async (url) => { hit = String(url); return okChat('{"ok":1}'); };
      await chatJson({ model: "gpt-5.5", system: "s", user: "u" });
      assert.equal(hit, "http://localhost:8099/v1/chat/completions");
    } finally { delete process.env.OPENAI_BASE_URL; }
  }));
