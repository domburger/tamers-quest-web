import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeLiveStages, toStrictSchema } from "./genStages.js";
import { runGenPipeline, buildAttributesSchema } from "./genPipeline.js";
import { setPrompts, resetPrompts } from "./prompts.js";

// TQ-432: prompt overrides are a process-wide singleton shared with the other gen test files; reset
// to defaults before every test so another file's leftover setPrompts() can't leak in (run-order flake).
beforeEach(resetPrompts);

// A fake LangChain chat: withStructuredOutput(schema, {name}) → { invoke } that records
// the prompts it was given and returns canned structured output keyed by the stage name.
function mockChat(canned, calls) {
  return {
    withStructuredOutput(schema, cfg) {
      const name = cfg && cfg.name;
      return {
        invoke: async (messages) => {
          calls.push({ name, schema, system: messages[0]?.content, user: messages[1]?.content });
          return canned[name];
        },
      };
    },
  };
}

const CANNED = {
  MonsterIdea: { inspiration: "volcanic armored beetle" }, // Stage 1 outputs ONLY inspiration (spec)
  MonsterAttributes: {
    typeName: "Cindercarapace", rarity: 3, size: 4,
    description: "A magma-shelled brute.", baseHealth: 120, baseDefense: 110, baseStrength: 70,
    baseSpeed: 40, basePower: 80, baseEnergy: 60, baseLuck: 30,
  },
  MonsterModel: {
    // TQ-259: the builder now authors the creature FROM SCRATCH as free-form HTML/CSS per state.
    canvas: 256,
    base: '<div style="position:relative;width:256px;height:256px"><div style="position:absolute;left:60px;top:120px;width:140px;height:90px;border-radius:50%;background:#7a2b1a"></div><div style="position:absolute;left:150px;top:130px;width:18px;height:18px;border-radius:50%;background:#ffb030"></div></div>',
  },
};

const ATTACKS = [{ name: "Ember", elementalType: "Fire" }, { name: "Gore", elementalType: "Normal" }, { name: "Stomp", elementalType: "Normal" }, { name: "Cinder Blast", elementalType: "Fire" }];

test("makeLiveStages: idea stage invokes structured output and returns it", async () => {
  const calls = [];
  const stages = makeLiveStages({ createChat: () => mockChat(CANNED, calls) });
  const idea = await stages.idea();
  assert.equal(idea.inspiration, "volcanic armored beetle");
  assert.equal(calls[0].name, "MonsterIdea");
  assert.ok(calls[0].system && calls[0].system.length > 0, "idea system prompt wired");
  // No "Constraints" / targeting-hints input — the prompt is the inspiration brief alone.
  assert.match(calls[0].user, /Give 2-4 words/, "idea user prompt wired");
  assert.doesNotMatch(calls[0].user, /\{hints\}|Constraints|Target rarity/, "no Constraints input injected");
});

test("makeLiveStages: a stray {hints} placeholder (old admin override) is stripped, not injected", async () => {
  await setPrompts({ genIdeaUser: "Design a cave monster. {hints}" });
  try {
    const calls = [];
    const stages = makeLiveStages({ createChat: () => mockChat(CANNED, calls) });
    await stages.idea();
    assert.match(calls[0].user, /Design a cave monster\./, "override text is used");
    assert.doesNotMatch(calls[0].user, /\{hints\}|Constraints/, "stray {hints} stripped to nothing");
  } finally {
    await setPrompts({ genIdeaUser: "" }); // reset to the default
  }
});

test("makeLiveStages: attributes stage threads the idea into its prompt", async () => {
  const calls = [];
  const stages = makeLiveStages({ createChat: () => mockChat(CANNED, calls) });
  await stages.attributes(CANNED.MonsterIdea);
  const attrCall = calls.find((c) => c.name === "MonsterAttributes");
  assert.ok(attrCall, "attributes stage invoked");
  assert.match(attrCall.user, /volcanic armored beetle/, "idea text threaded into attributes prompt");
  assert.doesNotMatch(attrCall.user, /\{hints\}|Constraints/, "no Constraints input injected");
});

test("live stages run through runGenPipeline into a valid MonsterType", async () => {
  const calls = [];
  const stages = makeLiveStages({ createChat: () => mockChat(CANNED, calls) });
  const res = await runGenPipeline(stages, { attackPool: ATTACKS, existingNames: new Set() });
  assert.ok(res && res.monster, "pipeline produced a monster");
  const m = res.monster;
  assert.equal(m.typeName, "Cindercarapace");
  assert.equal(m.rarity, 3);
  assert.equal(m.baseHealth, 120);
  assert.ok(m.attack_1, "attacks assigned");
  // assignAttacks picks 4 distinct attacks from the pool (random order, no element preference).
  assert.ok(["Ember", "Gore", "Stomp", "Cinder Blast"].includes(m.attack_1), "attack_1 is from the pool");
});

test("makeLiveStages: model stage included only with withModel, and runs via the pipeline", async () => {
  const calls = [];
  // Without withModel → no model stage.
  assert.equal(makeLiveStages({ createChat: () => mockChat(CANNED, calls) }).model, undefined);
  // With withModel → model stage runs and attaches a coerced spec to monster.model.
  const stages = makeLiveStages({ createChat: () => mockChat(CANNED, calls), withModel: true });
  assert.equal(typeof stages.model, "function");
  const res = await runGenPipeline(stages, { attackPool: ATTACKS, existingNames: new Set() });
  assert.ok(res.model, "pipeline returned a model spec");
  // TQ-259: the builder authored the creature as HTML/CSS; it's coerced + attached onto monster.html.
  assert.ok(res.monster.html && res.monster.html.base.includes("<div"), "authored HTML carried onto monster.html");
  assert.ok(res.monster.html.base.includes("background"), "coerced HTML keeps the inline-styled markup");
  const modelCall = calls.find((c) => c.name === "MonsterModel");
  assert.ok(modelCall, "model stage invoked");
  assert.match(modelCall.user, /Cindercarapace/, "monster threaded into model prompt");
  // The HTML render-target brief (the canvas box + allowed tags/CSS) is appended to the builder's
  // system prompt, so it authors HTML the TQ-261 sanitizer accepts.
  assert.match(modelCall.system, /RENDER TARGET/, "HTML render-target brief appended to builder system prompt");
  assert.match(modelCall.system, /FROM SCRATCH|HTML/i, "brief describes from-scratch free-form HTML/CSS");
});

test("toStrictSchema: OpenAI strict-mode compliant (all keys required, no unsupported keywords)", () => {
  const strict = toStrictSchema(buildAttributesSchema());
  // Every object lists ALL its keys in required + forbids extra props (strict-mode requirements).
  assert.equal(strict.additionalProperties, false);
  assert.deepEqual(strict.required.slice().sort(), Object.keys(strict.properties).sort());
  // Nested object (attacks items) is coerced too.
  const item = strict.properties.attacks.items;
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.required.slice().sort(), ["description", "title"]);
  // Unsupported validation keywords are stripped recursively (would 400 under strict mode).
  const json = JSON.stringify(strict);
  for (const kw of ["minimum", "maximum", "minItems", "maxItems", "pattern", "format"]) {
    assert.ok(!json.includes(`"${kw}"`), `strict schema must not contain ${kw}`);
  }
  // typeName is now guaranteed by the contract (present + required).
  assert.ok(strict.properties.typeName && strict.required.includes("typeName"));
  // Non-mutating: the source schema keeps its bounds.
  assert.equal(buildAttributesSchema().properties.rarity.minimum, 1);
});

