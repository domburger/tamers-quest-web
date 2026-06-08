import { test } from "node:test";
import assert from "node:assert/strict";
import { makeLiveStages, hintLine } from "./genStages.js";
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

test("hintLine: sanitized, omits empty fields", () => {
  assert.equal(hintLine({}), "");
  assert.match(hintLine({ element: "Storm" }), /Element: Storm\./);
  assert.match(hintLine({ rarity: 9 }), /Target rarity \(1-5\): 5/); // clamped
});
