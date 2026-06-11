import { test } from "node:test";
import assert from "node:assert/strict";
import { runGenPipeline, coerceIdea, coerceModel, IDEA_SCHEMA, ATTRIBUTES_SCHEMA, MODEL_SCHEMA } from "./genPipeline.js";

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
        return { typeName: "Magma Crab", element: "Fire", rarity: 4, baseHealth: 999, description: "A molten crustacean." };
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
  assert.equal(out.monster.element, "Fire");
  assert.equal(out.monster.rarity, 4);
  assert.ok(out.monster.baseHealth <= 400, "stat clamped to engine range");
  // attacks assigned from the provided pool (Fire-first since element is Fire)
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

test("coerceModel: clamps authored shapes into a render-ready model (drops junk, caps count)", () => {
  // The builder now authors the creature FROM SCRATCH as shape primitives; coerceModel is the
  // authored-shape clamp (src/systems/modelRender.js coerceAuthoredModel).
  const out = coerceModel({ shapes: [
    { kind: "ellipse", cx: 64, cy: 80, rx: 30, ry: 22, fill: "#445" },
    { kind: "circle", cx: 52, cy: 74, r: 5, fill: "#ff0" },
    { kind: "polygon", points: [[40, 60], [64, 20], [88, 60]], fill: "#234" },
    { kind: "limb", x1: 50, y1: 98, x2: 50, y2: 120, w: 6, fill: "#223" },
    { kind: "garbage" },                  // unknown kind → dropped
    { kind: "polygon", points: [[1, 2]] }, // <3 points → dropped
  ] });
  assert.equal(out.shapes.length, 4, "valid shapes kept, junk dropped");
  assert.equal(out.shapes[0].kind, "ellipse");
  assert.equal(out.shapes[0].fill, "#444455", "short hex expanded to full");
  assert.deepEqual(coerceModel(null).shapes, [], "junk → no shapes");
  assert.deepEqual(coerceModel({}).shapes, [], "missing shapes → []");
});

test("MODEL_SCHEMA is the authored-shapes contract", () => {
  assert.ok(MODEL_SCHEMA.properties.shapes, "has a shapes array");
  assert.deepEqual(MODEL_SCHEMA.properties.shapes.items.properties.kind.enum, ["ellipse", "circle", "polygon", "limb"]);
  assert.ok(MODEL_SCHEMA.required.includes("shapes"));
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

  // With a model stage → coerced authored shapes attached, and it receives {idea, monster}
  let ctx = null;
  const with3 = await runGenPipeline(
    { ...base, model: async (c) => { ctx = c; return { shapes: [
      { kind: "ellipse", cx: 64, cy: 80, rx: 28, ry: 20, fill: "#445" },
      { kind: "circle", cx: 54, cy: 74, r: 5, fill: "#fa0" },
      { kind: "polygon", points: [[44, 58], [64, 22], [84, 58]], fill: "#223" },
    ] }; } },
    { attackPool: ATTACK_POOL, rand: () => 0 }
  );
  assert.equal(with3.monster.model.shapes.length, 3, "authored shapes attached to monster.model");
  assert.equal(with3.monster.model.shapes[0].kind, "ellipse");
  assert.equal(ctx.idea.inspiration, "ash wolf"); // Stage 3 sees the idea (inspiration-only; legacy `theme` accepted as input)
  assert.equal(ctx.monster.typeName, "Ash Wolf"); // …and the built monster
});
