import { test } from "node:test";
import assert from "node:assert/strict";
import { makeLiveStages, hintLine } from "./genStages.js";
import { runGenPipeline } from "./genPipeline.js";
import { setPrompts } from "./prompts.js";

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
    typeName: "Cindercarapace", element: "Fire", rarity: 3, size: 4,
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
  const idea = await stages.idea({ element: "Fire", rarity: 3 });
  assert.equal(idea.inspiration, "volcanic armored beetle");
  assert.equal(calls[0].name, "MonsterIdea");
  assert.ok(calls[0].system && calls[0].system.length > 0, "idea system prompt wired");
  assert.match(calls[0].user, /Element: Fire/, "hints injected into the idea user prompt");
});

test("makeLiveStages: hints survive an admin override that drops the {hints} placeholder", async () => {
  // Reproduces the prod bug: the remade prompts had no {hints} slot, so the element hint was
  // silently lost and every monster converged on one concept. fillSlot now APPENDS it instead.
  await setPrompts({ genIdeaUser: "Design a cave monster. (this override has no placeholder)" });
  try {
    const calls = [];
    const stages = makeLiveStages({ createChat: () => mockChat(CANNED, calls) });
    await stages.idea({ element: "Fire" });
    assert.match(calls[0].user, /this override has no placeholder/, "override text is used");
    assert.match(calls[0].user, /Element: Fire — build the monster AROUND/, "element hint appended despite missing {hints}");
  } finally {
    await setPrompts({ genIdeaUser: "" }); // reset to the default
  }
});

test("makeLiveStages: attributes stage receives the idea + hints in its prompt", async () => {
  const calls = [];
  const stages = makeLiveStages({ createChat: () => mockChat(CANNED, calls) });
  await stages.attributes(CANNED.MonsterIdea, { element: "Fire", rarity: 3 });
  const attrCall = calls.find((c) => c.name === "MonsterAttributes");
  assert.ok(attrCall, "attributes stage invoked");
  assert.match(attrCall.user, /volcanic armored beetle/, "idea text threaded into attributes prompt");
  assert.match(attrCall.user, /Target rarity \(1-5\): 3/, "rarity hint threaded");
});

test("live stages run through runGenPipeline into a valid MonsterType", async () => {
  const calls = [];
  const stages = makeLiveStages({ createChat: () => mockChat(CANNED, calls) });
  const res = await runGenPipeline(stages, { attackPool: ATTACKS, existingNames: new Set() });
  assert.ok(res && res.monster, "pipeline produced a monster");
  const m = res.monster;
  assert.equal(m.typeName, "Cindercarapace");
  assert.equal(m.element, "Fire");
  assert.equal(m.rarity, 3);
  assert.equal(m.baseHealth, 120);
  assert.ok(m.attack_1, "attacks assigned");
  // assignAttacks shuffles same-element attacks to the front, so attack_1 is one of the
  // two Fire attacks (which one varies with the rng) — assert the same-element preference.
  assert.ok(["Ember", "Cinder Blast"].includes(m.attack_1), "a same-element (Fire) attack is first");
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

test("hintLine: sanitized, omits empty fields", () => {
  assert.equal(hintLine({}), "");
  assert.match(hintLine({ element: "Storm" }), /Element: Storm — build the monster AROUND/);
  assert.match(hintLine({ element: "Storm" }), /do NOT drift to a different element/);
  assert.match(hintLine({ archetype: "leviathan" }), /Lean toward a leviathan silhouette/);
  assert.match(hintLine({ rarity: 9 }), /Target rarity \(1-5\): 5/); // clamped
});
