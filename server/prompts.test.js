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
