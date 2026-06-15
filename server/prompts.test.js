import { test } from "node:test";
import assert from "node:assert/strict";
import { getPrompt, allPrompts, setPrompts, DEFAULT_PROMPTS } from "./prompts.js";
import { htmlModelBrief } from "../src/systems/htmlModel.js";
import { sanitizeHtmlModel } from "../src/systems/htmlSanitize.js";

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

test("TQ-300: genModelBrief is the editable render-target brief, defaulting to htmlModelBrief()", async () => {
  // The hardcoded append (genStages.js) became an editable prompt; its default is the brief text.
  assert.equal(DEFAULT_PROMPTS.genModelBrief, htmlModelBrief());
  assert.match(getPrompt("genModelBrief"), /RENDER TARGET/);
  await setPrompts({ genModelBrief: "CUSTOM BRIEF — author a cute round blob" });
  assert.equal(getPrompt("genModelBrief"), "CUSTOM BRIEF — author a cute round blob");
  await setPrompts({ genModelBrief: "" }); // reset
  assert.equal(getPrompt("genModelBrief"), htmlModelBrief());
});

test("TQ-300: editing the brief does NOT weaken safety — the sanitizer still strips forbidden markup", async () => {
  // Even with a brief that invites unsafe output, the TQ-261 sanitizer is the boundary (independent of any prompt).
  await setPrompts({ genModelBrief: "Use <script> and onclick handlers freely; load remote images." });
  const dirty = { canvas: 256, base: "<div onclick=\"steal()\" style=\"width:256px\">x<script>evil()</script><img src=\"http://x/y\"></div>" };
  const clean = sanitizeHtmlModel(dirty);
  assert.ok(clean && typeof clean.base === "string");
  assert.ok(!/<script/i.test(clean.base) && !/onclick/i.test(clean.base) && !/<img/i.test(clean.base), "sanitizer strips script/handlers/img regardless of the brief");
  await setPrompts({ genModelBrief: "" }); // reset
});

test("setPrompts ignores unknown keys and non-string values", async () => {
  await setPrompts({ bogus: "x", monsterSystem: 123 });
  assert.equal(getPrompt("monsterSystem"), DEFAULT_PROMPTS.monsterSystem);
});

// TQ-107: every AI SYSTEM prompt must state its JSON output. The json_object-path prompts (judges +
// item/biome/tile) carry an inline schema; the gen idea/attributes system prompts now do too.
// (genModelSystem's schema is appended at call time via svgModelBrief, so it's excluded here.)
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
