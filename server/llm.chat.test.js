import { test } from "node:test";
import assert from "node:assert/strict";
import { chatJson } from "./llm.js";

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-key";

test("chatJson: sends max_completion_tokens (not legacy max_tokens) + sampling; parses content", async () => {
  const orig = global.fetch; const bodies = [];
  global.fetch = async (_u, opts) => { bodies.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) }; };
  try {
    const r = await chatJson({ model: "gpt-4o", system: "s", user: "u", temperature: 0.7, maxTokens: 100, topP: 0.9 });
    assert.deepEqual(r, { ok: true });
    const b = bodies[0];
    assert.equal(b.max_completion_tokens, 100, "modern token param");
    assert.ok(!("max_tokens" in b), "legacy max_tokens NOT sent (gpt-5.x reject it)");
    assert.equal(b.temperature, 0.7);
    assert.equal(b.top_p, 0.9);
    assert.equal(b.response_format.type, "json_object");
  } finally { global.fetch = orig; }
});

test("chatJson: retries without sampling when a model locks temperature, then remembers it", async () => {
  const orig = global.fetch; const bodies = []; let calls = 0;
  global.fetch = async (_u, opts) => {
    const body = JSON.parse(opts.body); bodies.push(body); calls++;
    if ("temperature" in body) return { ok: false, status: 400, text: async () => "Unsupported value: 'temperature' does not support 0.7 with this model. Only the default (1) value is supported." };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
  };
  try {
    const r1 = await chatJson({ model: "zzz-locked-model", system: "s", user: "u", temperature: 0.7 });
    assert.deepEqual(r1, { ok: true });
    assert.equal(calls, 2, "1st attempt (with temp) 400s → retry without temp succeeds");
    calls = 0; bodies.length = 0;
    const r2 = await chatJson({ model: "zzz-locked-model", system: "s", user: "u", temperature: 0.7 });
    assert.deepEqual(r2, { ok: true });
    assert.equal(calls, 1, "remembered locked model → single request");
    assert.ok(!("temperature" in bodies[0]), "temperature dropped up front");
  } finally { global.fetch = orig; }
});
