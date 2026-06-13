import { test } from "node:test";
import assert from "node:assert/strict";
import { getPrompt, allPrompts, setPrompts, DEFAULT_PROMPTS } from "./prompts.js";

test("getPrompt returns the default, then the override, then default after reset", async () => {
  assert.equal(getPrompt("combatSystem"), DEFAULT_PROMPTS.combatSystem);
  await setPrompts({ combatSystem: "CUSTOM COMBAT" });
  assert.equal(getPrompt("combatSystem"), "CUSTOM COMBAT");
  const all = allPrompts();
  assert.equal(all.combatSystem.current, "CUSTOM COMBAT");
  assert.equal(all.combatSystem.overridden, true);
  assert.equal(all.combatSystem.default, DEFAULT_PROMPTS.combatSystem);
  await setPrompts({ combatSystem: "" }); // clear → reset to default
  assert.equal(getPrompt("combatSystem"), DEFAULT_PROMPTS.combatSystem);
  assert.equal(allPrompts().combatSystem.overridden, false);
});

test("inspiration prompt asks for 2-4 words 'to characterize the monster' (spec)", () => {
  const idea = (DEFAULT_PROMPTS.genIdeaSystem + " " + DEFAULT_PROMPTS.genIdeaUser).toLowerCase();
  assert.ok(idea.includes("to characterize the monster"), "the literal spec phrase must appear in the inspiration prompt");
  assert.ok(idea.includes("2-4 words"), "the inspiration agent gives 2-4 words");
});

test("setPrompts ignores unknown keys and non-string values", async () => {
  await setPrompts({ bogus: "x", monsterSystem: 123 });
  assert.equal(getPrompt("monsterSystem"), DEFAULT_PROMPTS.monsterSystem);
});

// TQ-107: every AI SYSTEM prompt must state its JSON output. The json_object-path prompts (judges +
// item/biome/tile) carry an inline schema; the gen idea/attributes system prompts now do too.
// (genModelSystem's schema is appended at call time via authoredModelBrief, so it's excluded here.)
test("every AI system prompt states its JSON output (TQ-107)", () => {
  const systemKeys = [
    "combatSystem", "combatJudgeV2System", "catchJudgeSystem",
    "itemIdeaSystem", "itemDesignerSystem", "biomeIdeaSystem", "biomeDesignerSystem",
    "tileIdeaSystem", "tileDesignerSystem", "genIdeaSystem", "genAttributesSystem",
  ];
  for (const k of systemKeys) {
    assert.ok(typeof DEFAULT_PROMPTS[k] === "string", `${k} exists`);
    assert.match(DEFAULT_PROMPTS[k], /JSON/i, `${k} should describe its JSON output`);
  }
});
