import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { evolveMonster, evolveOnLevelUp } from "./genEvolve.js";
import { buildEvolutionSchema, normalizeEvolutionResult } from "./evolution.js";
import { toStrictSchema } from "./genStages.js";
import { resetPrompts } from "./prompts.js";

beforeEach(resetPrompts);

// Same fake LangChain chat shape as genStages.test.js: records the prompts, returns canned output by name.
function mockChat(canned, calls) {
  return {
    withStructuredOutput(schema, cfg) {
      const name = cfg && cfg.name;
      return { invoke: async (messages) => { calls.push({ name, schema, system: messages[0]?.content, user: messages[1]?.content }); return canned[name]; } };
    },
  };
}

const monster = () => ({
  name: "Emberling",
  attributes: { hp: 40, attack: 12 },
  html: { canvas: 256, base: '<div class="body"><span class="flame">small</span></div>', idle: '<div class="body idle">small</div>' },
});
const CANNED = {
  MonsterEvolution: {
    name: "Emberbeast",
    attrEdits: [{ stat: "hp", value: 70 }, { stat: "attack", value: 20 }],
    modelEdits: [{ state: "base", edits: [{ oldString: "small", newString: "huge blazing" }] }],
  },
};

const withKey = async (fn) => { const prev = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "test-key"; try { return await fn(); } finally { if (prev === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prev; } };

test("TQ-551 evolveMonster: calls the agent, normalizes its edits, and evolves the monster in place", async () => {
  await withKey(async () => {
    const m = monster();
    const calls = [];
    const res = await evolveMonster(m, 15, { createChat: () => mockChat(CANNED, calls), model: "gpt-5.5" });
    assert.equal(res.ok, true);
    assert.equal(m.name, "Emberbeast", "renamed to evolved form");
    assert.match(m.html.base, /huge blazing/, "base markup edited via the replace tool");
    assert.equal(m.attributes.hp, 70); assert.equal(m.attributes.attack, 20);
    assert.deepEqual(m.evolvedLevels, [15]);
    // the agent was prompted with the current model markup (so it can copy oldStrings verbatim) + the level
    const call = calls.find((c) => c.name === "MonsterEvolution");
    assert.ok(call, "evolution agent invoked");
    assert.match(call.user, /small/, "prompt includes the current markup to edit");
    assert.match(call.user, /Emberling/, "prompt includes the monster identity");
  });
});

test("TQ-551 evolveMonster: gated off when AI is disabled / no model present", async () => {
  const prev = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
  try {
    const r = await evolveMonster(monster(), 15, { createChat: () => mockChat(CANNED, []) });
    assert.equal(r.ok, false); assert.equal(r.error, "ai_disabled");
  } finally { if (prev !== undefined) process.env.OPENAI_API_KEY = prev; }
  await withKey(async () => {
    const r = await evolveMonster({ name: "x", html: {} }, 15, { createChat: () => mockChat(CANNED, []) });
    assert.equal(r.ok, false); assert.equal(r.error, "no_model");
  });
});

test("TQ-551 buildEvolutionSchema: survives strict-mode coercion (required keys, no open maps)", () => {
  const strict = toStrictSchema(buildEvolutionSchema());
  assert.deepEqual(strict.required.sort(), ["attrEdits", "modelEdits", "name"]);
  assert.equal(strict.additionalProperties, false);
  // every nested object is locked down for strict structured output
  const editItem = strict.properties.modelEdits.items.properties.edits.items;
  assert.deepEqual(editItem.required.sort(), ["newString", "oldString"]);
  assert.equal(editItem.additionalProperties, false);
});

test("TQ-551 evolveOnLevelUp: fires the agent only when a fixed level is crossed; never blocks the level-up", async () => {
  // crossing 15 → evolves (inject a mock evolve so no AI/key needed)
  let called = 0;
  const evolve = async (m, level) => { called++; m.evolvedLevels = [...(m.evolvedLevels || []), level]; return { ok: true, monster: m }; };
  const m = monster();
  const r = await evolveOnLevelUp(m, 14, 15, { evolve });
  assert.deepEqual(r, { evolved: true, level: 15 });
  assert.equal(called, 1);

  // not crossing a fixed level → no agent call
  called = 0;
  const r2 = await evolveOnLevelUp(monster(), 10, 14, { evolve });
  assert.deepEqual(r2, { evolved: false });
  assert.equal(called, 0, "agent not invoked when no fixed level is crossed");

  // already evolved at 15 → idempotent, no re-fire
  const evolved = { ...monster(), evolvedLevels: [15] };
  assert.deepEqual(await evolveOnLevelUp(evolved, 14, 20, { evolve: async () => ({ ok: true }) }), { evolved: false });
});

test("TQ-551 evolveOnLevelUp: a failed/throwing evolution is swallowed (level-up still stands, no record)", async () => {
  const m = monster();
  const r = await evolveOnLevelUp(m, 14, 15, { evolve: async () => ({ ok: false, error: "model_base_not_found" }) });
  assert.deepEqual(r, { evolved: false, level: 15, error: "model_base_not_found" });
  assert.equal((m.evolvedLevels || []).length, 0, "not recorded → re-offered next level-up");
  const r2 = await evolveOnLevelUp(monster(), 14, 15, { evolve: async () => { throw new Error("boom"); } });
  assert.equal(r2.evolved, false); assert.match(r2.error, /boom/, "a thrown agent error never propagates");
});

test("TQ-551 normalizeEvolutionResult: array wire shape → {name, attrEdits{}, modelEdits{}}; tolerant of junk", () => {
  const out = normalizeEvolutionResult({ name: " Big ", attrEdits: [{ stat: "hp", value: 9 }, { stat: "x", value: "nope" }], modelEdits: [{ state: "base", edits: [{ oldString: "a", newString: "b" }] }, { junk: true }] });
  assert.equal(out.name, "Big");
  assert.deepEqual(out.attrEdits, { hp: 9 }, "non-numeric value dropped");
  assert.deepEqual(out.modelEdits, { base: [{ oldString: "a", newString: "b" }] }, "malformed state entry dropped");
  assert.equal(normalizeEvolutionResult(null), null);
});
