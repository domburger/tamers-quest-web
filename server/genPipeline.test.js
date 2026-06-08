import { test } from "node:test";
import assert from "node:assert/strict";
import { runGenPipeline, coerceIdea, coerceModel, BODY_SHAPES, IDEA_SCHEMA, ATTRIBUTES_SCHEMA, MODEL_SCHEMA } from "./genPipeline.js";

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

test("coerceModel: snaps bodyShape to a known archetype, clamps anims, caps features", () => {
  const d = coerceModel({});
  assert.ok(BODY_SHAPES.includes(d.bodyShape), "default bodyShape is a known archetype");
  assert.equal(coerceModel({ bodyShape: "unicorn" }).bodyShape, "beast"); // invalid → fallback
  assert.equal(coerceModel({ bodyShape: "raptor" }).bodyShape, "raptor");
  // animation params clamp into safe ranges (no frozen/vibrating creatures)
  const clamped = coerceModel({ animations: { idle: { bob: 9, speed: 0.01 }, attack: { lunge: -5, speed: 99 } } });
  assert.equal(clamped.animations.idle.bob, 1);
  assert.equal(clamped.animations.idle.speed, 0.5);
  assert.equal(clamped.animations.attack.lunge, 0);
  assert.equal(clamped.animations.attack.speed, 3);
  // features: only non-empty strings, capped at 6, trimmed/truncated
  const feats = coerceModel({ features: ["horns", "  ", 7, "x".repeat(99), "a", "b", "c", "d", "e", "f"] }).features;
  assert.ok(feats.length <= 6 && feats.includes("horns"));
  assert.ok(feats.every((f) => typeof f === "string" && f.length <= 32));
  assert.deepEqual(coerceModel(null).palette.primary, ""); // junk → empty palette (renderer falls back)
});

test("MODEL_SCHEMA constrains bodyShape to the archetype enum", () => {
  assert.deepEqual(MODEL_SCHEMA.properties.bodyShape.enum, BODY_SHAPES);
  assert.ok(MODEL_SCHEMA.required.includes("bodyShape"));
});

test("runGenPipeline: optional Stage-3 model attaches monster.model; absent stage is backward-compatible", async () => {
  const base = {
    idea: async () => ({ theme: "ash wolf", vibe: "feral", role: "bruiser" }),
    attributes: async () => ({ typeName: "Ash Wolf", element: "Fire", rarity: 3 }),
  };
  // No model stage → unchanged shape (model null, no monster.model)
  const without = await runGenPipeline(base, { attackPool: ATTACK_POOL, rand: () => 0 });
  assert.equal(without.model, null);
  assert.equal(without.monster.model, undefined);

  // With a model stage → coerced spec attached, and it receives {idea, monster}
  let ctx = null;
  const with3 = await runGenPipeline(
    { ...base, model: async (c) => { ctx = c; return { bodyShape: "raptor", features: ["fangs"] }; } },
    { attackPool: ATTACK_POOL, rand: () => 0 }
  );
  assert.equal(with3.model.bodyShape, "raptor");
  assert.equal(with3.monster.model.bodyShape, "raptor");
  assert.equal(ctx.idea.theme, "ash wolf"); // Stage 3 sees the idea
  assert.equal(ctx.monster.typeName, "Ash Wolf"); // …and the built monster
});

test("runGenPipeline: optional Stage-4 review can patch the monster; null return keeps it", async () => {
  const base = {
    idea: async () => ({ theme: "ash wolf", vibe: "feral", role: "bruiser" }),
    attributes: async () => ({ typeName: "Ash Wolf", element: "Fire", rarity: 3 }),
  };
  // review returns a patched monster (the stage owns patch-application) + sees {idea, monster, model}
  let rctx = null;
  const reviewed = await runGenPipeline(
    {
      ...base,
      model: async () => ({ bodyShape: "raptor" }),
      review: async (c) => { rctx = c; return { ...c.monster, typeName: "Ash Wolf Alpha" }; },
    },
    { attackPool: ATTACK_POOL, rand: () => 0 }
  );
  assert.equal(reviewed.monster.typeName, "Ash Wolf Alpha", "review patch applied");
  assert.equal(rctx.idea.theme, "ash wolf");
  assert.equal(rctx.model.bodyShape, "raptor"); // Stage 4 sees the model spec
  assert.equal(reviewed.monster.element, "Fire"); // untouched fields survive

  // a null/invalid review return keeps the unreviewed monster (never blocks)
  const kept = await runGenPipeline(
    { ...base, review: async () => null },
    { attackPool: ATTACK_POOL, rand: () => 0 }
  );
  assert.equal(kept.monster.typeName, "Ash Wolf");

  // no review stage → backward-compatible (unchanged)
  const none = await runGenPipeline(base, { attackPool: ATTACK_POOL, rand: () => 0 });
  assert.equal(none.monster.typeName, "Ash Wolf");
});
