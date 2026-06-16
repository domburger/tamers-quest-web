import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeGeneratedItem, aiGenerateItem, buildItemDesignerPrompt } from "./genItems.js";
import { DEFAULT_PROMPTS, setPrompts } from "./prompts.js";

test("normalizeGeneratedItem: a simple {id,name,description}, defaulted + clamped", () => {
  const it = normalizeGeneratedItem({ name: "Ember Vial", description: "Hurl it to deal Fire damage and maybe Burn the enemy." }, { id: 3 });
  assert.equal(it.id, 3);
  assert.equal(it.name, "Ember Vial");
  assert.ok(it.description.includes("Fire"));
  // accepts alt field names; defaults a missing name; caps long text
  assert.equal(normalizeGeneratedItem({ action: "Heals your monster a little." }).name, "Curio");
  assert.equal(normalizeGeneratedItem({ name: "X", effect: "does a thing" }).description, "does a thing");
  assert.ok(normalizeGeneratedItem({ name: "L", description: "x".repeat(500) }).description.length <= 250, "long description is capped (~240 + ellipsis)");
});

test("normalizeGeneratedItem: name is made unique vs existingNames", () => {
  const existing = new Set(["Potion", "Potion 2"]);
  assert.equal(normalizeGeneratedItem({ name: "Potion" }, { existingNames: existing }).name, "Potion 3");
});

test("aiGenerateItem: inspiration -> designer -> normalized item (mocked chat)", async () => {
  const origKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key"; // aiEnabled()
  const calls = [];
  const chat = async (system, user) => {
    calls.push({ system, user });
    if (calls.length === 1) return { inspiration: "smoking tar bomb" };                                                     // stage 1: inspiration
    if (calls.length === 2) return { name: "Tar Bomb", description: "Throw to coat the enemy in burning tar — Fire damage that lingers." }; // stage 2: designer
    return { visual: { layers: [{ type: "disc", cx: 0.5, cy: 0.5, r: 0.3, color: { r: 40, g: 30, b: 20 } }] } };           // stage 3: builder (TQ-390)
  };
  try {
    const it = await aiGenerateItem({ id: 9 }, { chat });
    assert.equal(calls.length, 3, "three stages: inspiration -> designer -> builder (TQ-390)");
    assert.ok(calls[1].user.includes("smoking tar bomb"), "designer received the inspiration");
    assert.ok(calls[2].user.includes("Tar Bomb"), "builder received the designed item");
    assert.equal(it.name, "Tar Bomb");
    assert.ok(it.description.includes("Fire"));
    assert.equal(it.id, 9);
    assert.ok(it.visual && it.visual.layers.length === 1, "builder-authored icon visual attached + coerced");
  } finally {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origKey;
  }
});

test("aiGenerateItem: returns null when AI is disabled (no key)", async () => {
  const origKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try { assert.equal(await aiGenerateItem(), null); }
  finally { if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey; }
});

test("item prompts: inspiration asks for 2-4 words + spans the full toolkit (heal + harm)", () => {
  const idea = (DEFAULT_PROMPTS.itemIdeaSystem + " " + DEFAULT_PROMPTS.itemIdeaUser).toLowerCase();
  assert.ok(idea.includes("to characterize"), "characterize-the-item framing present");
  assert.ok(idea.includes("2-4 words"));
  // items must NOT be all enemy-debuffs — the inspiration spans self-help + offence.
  assert.ok(idea.includes("heal") && idea.includes("enemy"), "covers helping your own monster AND harming the enemy");
  // the inspiration user prompt carries the role hint via {kind} (filled by buildItemInspirationPrompt)
  assert.ok(DEFAULT_PROMPTS.itemIdeaUser.includes("{kind}"), "user prompt has a {kind} slot for the role hint");
  // the designer prompt is filled with the inspiration verbatim (function replacement, $-safe)
  assert.ok(buildItemDesignerPrompt("a$b inspiration").user.includes("a$b inspiration"));
});

test("item designer: inspiration survives an admin override that drops the {inspiration} slot", async () => {
  // Same robustness as the monster pipeline — an override without the placeholder must not
  // silently lose the inspiration (which would make the designer ignore stage 1).
  await setPrompts({ itemDesignerUser: "Design a combat item as JSON {name,description}." });
  try {
    const out = buildItemDesignerPrompt("smoking tar bomb").user;
    assert.ok(out.includes("Design a combat item"), "override text used");
    assert.ok(out.includes("smoking tar bomb"), "inspiration appended despite missing {inspiration}");
  } finally {
    await setPrompts({ itemDesignerUser: "" }); // reset to default
  }
});
