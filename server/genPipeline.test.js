import { test } from "node:test";
import assert from "node:assert/strict";
import { runGenPipeline, coerceIdea, IDEA_SCHEMA, ATTRIBUTES_SCHEMA } from "./genPipeline.js";

const ATTACK_POOL = [
  { name: "Bash", elementalType: "Normal" },
  { name: "Flare", elementalType: "Fire" },
  { name: "Gust", elementalType: "Air" },
  { name: "Bite", elementalType: "Normal" },
  { name: "Quake", elementalType: "Earth" },
];

test("coerceIdea: emits ONLY inspiration (spec), with a default + legacy-theme fallback + truncation", () => {
  // Stage 1's sole output is `inspiration` — no vibe/role/element/rarity fields.
  const d = coerceIdea({ inspiration: "magma crab" });
  assert.deepEqual(Object.keys(d), ["inspiration"], "idea carries nothing but inspiration");
  assert.equal(d.inspiration, "magma crab");
  assert.ok(coerceIdea({}).inspiration.length > 0, "missing → a usable default");
  assert.equal(coerceIdea({ theme: "ash wolf" }).inspiration, "ash wolf", "legacy `theme` accepted as a fallback input");
  assert.ok(coerceIdea({ inspiration: "x".repeat(500) }).inspiration.length <= 120, "truncated");
  assert.equal(typeof coerceIdea(null).inspiration, "string"); // non-object → default
  assert.equal(typeof coerceIdea("garbage").inspiration, "string");
});

test("schemas are well-formed and ATTRIBUTES covers every engine stat", () => {
  assert.equal(IDEA_SCHEMA.type, "object");
  assert.ok(IDEA_SCHEMA.properties.inspiration && IDEA_SCHEMA.required.includes("inspiration"), "IDEA requires the 2-4 word inspiration (spec)");
  assert.deepEqual(Object.keys(IDEA_SCHEMA.properties), ["inspiration"], "IDEA outputs ONLY inspiration — no other fields (spec)");
  for (const stat of ["Health", "Strength", "Defense", "Speed", "Power", "Energy", "Luck"]) {
    assert.ok(ATTRIBUTES_SCHEMA.properties[`base${stat}`], `base${stat} in schema`);
    assert.ok(ATTRIBUTES_SCHEMA.properties[`${stat.toLowerCase()}Scaling2`], `${stat} scaling2 in schema`);
  }
  // the scaling2 ceiling matches the engine clamp (CN-4) so the LLM is asked for valid values
  assert.equal(ATTRIBUTES_SCHEMA.properties.healthScaling2.maximum, 1.3);
});

test("runGenPipeline: threads idea → attributes and yields a valid MonsterType", async () => {
  let sawIdea = null;
  const out = await runGenPipeline(
    {
      idea: async () => ({ inspiration: "magma crab" }),
      attributes: async (idea) => {
        sawIdea = idea;
        return { typeName: "Magma Crab", rarity: 4, baseHealth: 999, description: "A molten crustacean." };
      },
    },
    { attackPool: ATTACK_POOL, rand: () => 0 }
  );
  assert.ok(out && out.monster, "pipeline produced a monster");
  // idea was coerced (inspiration-only) and handed to the attributes stage
  assert.equal(sawIdea.inspiration, "magma crab");
  assert.deepEqual(Object.keys(sawIdea), ["inspiration"], "attributes stage receives ONLY inspiration");
  // attributes were normalized/clamped by normalizeGeneratedMonster
  assert.equal(out.monster.typeName, "Magma Crab");
  assert.equal(out.monster.rarity, 4);
  assert.ok(out.monster.baseHealth <= 400, "stat clamped to engine range");
  // attacks assigned from the provided pool (deterministic shuffle with rand=0)
  assert.equal(out.monster.attack_1, "Flare");
  assert.ok(out.monster.attack_2 && out.monster.attack_3 && out.monster.attack_4);
  assert.equal(out.idea.inspiration, "magma crab");
});

test("runGenPipeline: a failed/empty stage yields null (not a crash)", async () => {
  const nullAttr = await runGenPipeline(
    { idea: async () => ({ theme: "x" }), attributes: async () => null },
    { attackPool: ATTACK_POOL }
  );
  assert.equal(nullAttr, null);

  const throwing = await runGenPipeline(
    { idea: async () => { throw new Error("LLM down"); }, attributes: async () => ({}) },
    { attackPool: ATTACK_POOL }
  );
  assert.equal(throwing, null);
});

test("runGenPipeline: missing stage functions reject with a clear error", async () => {
  await assert.rejects(() => runGenPipeline({}, {}), /must be functions/);
});

test("runGenPipeline: optional Stage-3 model attaches monster.html; absent stage is backward-compatible", async () => {
  const base = {
    idea: async () => ({ theme: "ash wolf", vibe: "feral", role: "bruiser" }),
    attributes: async () => ({ typeName: "Ash Wolf", rarity: 3 }),
  };
  // No model stage → unchanged shape (model null, no monster.html)
  const without = await runGenPipeline(base, { attackPool: ATTACK_POOL, rand: () => 0 });
  assert.equal(without.model, null);
  assert.equal(without.monster.html, undefined);

  // TQ-259: with a model stage → the coerced HTML is attached to monster.html; ctx = {idea, monster}
  let ctx = null;
  const with3 = await runGenPipeline(
    { ...base, model: async (c) => { ctx = c; return { canvas: 256, base: '<div style="width:256px;height:256px;background:#445"><span style="background:#fa0"></span></div>' }; } },
    { attackPool: ATTACK_POOL, rand: () => 0 }
  );
  assert.ok(with3.monster.html && with3.monster.html.base.includes("<div"), "authored HTML attached to monster.html");
  assert.ok(with3.monster.html.base.includes("background"), "coerced HTML keeps the inline-styled markup");
  assert.equal(ctx.idea.inspiration, "ash wolf"); // Stage 3 sees the idea (inspiration-only; legacy `theme` accepted as input)
  assert.equal(ctx.monster.typeName, "Ash Wolf"); // …and the built monster
});
