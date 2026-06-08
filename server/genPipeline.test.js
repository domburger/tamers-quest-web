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

test("coerceIdea: fills defaults, clamps rarity, truncates, tolerates junk", () => {
  const d = coerceIdea({});
  assert.equal(typeof d.theme, "string");
  assert.ok(d.theme.length > 0 && d.role.length > 0);
  assert.equal(coerceIdea({ rarityHint: 99 }).rarityHint, 5);
  assert.equal(coerceIdea({ rarityHint: -3 }).rarityHint, 1);
  assert.equal(coerceIdea({ rarityHint: 3.6 }).rarityHint, 4); // rounded
  assert.ok(coerceIdea({ theme: "x".repeat(500) }).theme.length <= 120);
  assert.deepEqual(coerceIdea(null).rarityHint, 2); // non-object → defaults
  assert.equal(coerceIdea("garbage").role, "bruiser");
});

test("schemas are well-formed and ATTRIBUTES covers every engine stat", () => {
  assert.equal(IDEA_SCHEMA.type, "object");
  assert.ok(IDEA_SCHEMA.properties.theme && IDEA_SCHEMA.required.includes("theme"));
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
      idea: async () => ({ theme: "magma crab", vibe: "brutal", role: "tank", elementHint: "Fire", rarityHint: 4 }),
      attributes: async (idea) => {
        sawIdea = idea;
        return { typeName: "Magma Crab", element: "Fire", rarity: 4, baseHealth: 999, description: "A molten crustacean." };
      },
    },
    { attackPool: ATTACK_POOL, rand: () => 0 }
  );
  assert.ok(out && out.monster, "pipeline produced a monster");
  // idea was coerced and handed to the attributes stage
  assert.equal(sawIdea.role, "tank");
  assert.equal(sawIdea.rarityHint, 4);
  // attributes were normalized/clamped by normalizeGeneratedMonster
  assert.equal(out.monster.typeName, "Magma Crab");
  assert.equal(out.monster.element, "Fire");
  assert.equal(out.monster.rarity, 4);
  assert.ok(out.monster.baseHealth <= 400, "stat clamped to engine range");
  // attacks assigned from the provided pool (Fire-first since element is Fire)
  assert.equal(out.monster.attack_1, "Flare");
  assert.ok(out.monster.attack_2 && out.monster.attack_3 && out.monster.attack_4);
  assert.equal(out.idea.theme, "magma crab");
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
