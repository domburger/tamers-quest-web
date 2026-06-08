import { test } from "node:test";
import assert from "node:assert/strict";
import { makeLiveStages, hintLine, applyReview, reviewMonster } from "./genStages.js";
import { runGenPipeline } from "./genPipeline.js";

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
  MonsterIdea: { theme: "volcanic armored beetle", vibe: "brutal and territorial", role: "tank", elementHint: "Fire", rarityHint: 3 },
  MonsterAttributes: {
    typeName: "Cindercarapace", element: "Fire", rarity: 3, size: 4,
    description: "A magma-shelled brute.", baseHealth: 120, baseDefense: 110, baseStrength: 70,
    baseSpeed: 40, basePower: 80, baseEnergy: 60, baseLuck: 30,
  },
  MonsterModel: {
    bodyShape: "arthropod", palette: { primary: "#7a2b1a", secondary: "ash", accent: "ember" },
    features: ["segmented carapace", "magma cracks"], animations: { idle: { bob: 0.2, speed: 0.8 }, attack: { lunge: 0.7, speed: 1.2 } },
  },
};

const ATTACKS = [{ name: "Ember", elementalType: "Fire" }, { name: "Gore", elementalType: "Normal" }, { name: "Stomp", elementalType: "Normal" }, { name: "Cinder Blast", elementalType: "Fire" }];

test("makeLiveStages: idea stage invokes structured output and returns it", async () => {
  const calls = [];
  const stages = makeLiveStages({ createChat: () => mockChat(CANNED, calls) });
  const idea = await stages.idea({ element: "Fire", rarity: 3 });
  assert.equal(idea.theme, "volcanic armored beetle");
  assert.equal(calls[0].name, "MonsterIdea");
  assert.ok(calls[0].system && calls[0].system.length > 0, "idea system prompt wired");
  assert.match(calls[0].user, /Element: Fire/, "hints injected into the idea user prompt");
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
  assert.equal(res.monster.model.bodyShape, "arthropod", "bodyShape carried onto monster.model");
  assert.deepEqual(res.monster.model.animations.idle, { bob: 0.2, speed: 0.8 }, "anim params preserved");
  const modelCall = calls.find((c) => c.name === "MonsterModel");
  assert.ok(modelCall, "model stage invoked");
  assert.match(modelCall.user, /Cindercarapace/, "monster threaded into model prompt");
});

test("hintLine: sanitized, omits empty fields", () => {
  assert.equal(hintLine({}), "");
  assert.match(hintLine({ element: "Storm" }), /Element: Storm\./);
  assert.match(hintLine({ rarity: 9 }), /Target rarity \(1-5\): 5/); // clamped
});

// ─── Stage 4 — Review ───
const REVIEWED = {
  typeName: "Cindercarapace", element: "Fire", rarity: 2, size: 4, description: "x",
  baseHealth: 120, baseStrength: 70, baseDefense: 110, baseSpeed: 40, basePower: 80, baseEnergy: 60, baseLuck: 30,
  attack_1: "Ember", attack_2: "Gore", attack_3: "Stomp", attack_4: "Cinder Blast", id: "m_1_2",
};

test("applyReview: approved verdict leaves the monster unchanged", () => {
  assert.equal(applyReview(REVIEWED, { approved: true }), REVIEWED);
  assert.equal(applyReview(REVIEWED, { approved: false }), REVIEWED, "no changes → unchanged");
  assert.equal(applyReview(REVIEWED, { approved: false, changes: {} }), REVIEWED, "empty changes → unchanged");
});

test("applyReview: merges + clamps changes and preserves attacks/id", () => {
  const out = applyReview(REVIEWED, { approved: false, changes: { rarity: 9, baseDefense: 999, description: "magma brute" } });
  assert.equal(out.rarity, 5, "rarity clamped to 5");
  assert.equal(out.baseDefense, 400, "stat clamped to 400");
  assert.equal(out.description, "magma brute", "string change applied");
  assert.equal(out.baseStrength, 70, "untouched stat preserved");
  assert.deepEqual([out.attack_1, out.attack_4], ["Ember", "Cinder Blast"], "attacks preserved through re-normalize");
  assert.equal(out.id, "m_1_2", "id preserved");
});

test("applyReview: ignores unknown change fields (normalize is the whitelist)", () => {
  const out = applyReview(REVIEWED, { approved: false, changes: { hacked: "x", __proto__: { polluted: 1 }, rarity: 3 } });
  assert.equal(out.rarity, 3);
  assert.equal(out.hacked, undefined, "unknown field dropped by normalize");
});

test("reviewMonster: invokes the review structured output", async () => {
  const calls = [];
  const chat = {
    withStructuredOutput(schema, cfg) {
      return { invoke: async (msgs) => { calls.push({ name: cfg.name, user: msgs[1].content }); return { approved: false, changes: { rarity: 4 } }; } };
    },
  };
  const verdict = await reviewMonster(REVIEWED, { createChat: () => chat });
  assert.equal(verdict.changes.rarity, 4);
  assert.equal(calls[0].name, "MonsterReview");
  assert.match(calls[0].user, /Cindercarapace/, "monster summary threaded into the review prompt");
});
