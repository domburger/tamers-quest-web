import { test } from "node:test";
import assert from "node:assert/strict";
import { EVOLUTION_LEVELS, EVOLUTION_MAX_GROWTH, pendingEvolution, applyReplaceEdits, applyAttrEdits, applyEvolution, buildEvolvedType } from "./evolution.js";

// A monster TYPE shape: stats are top-level base* fields (src/engine/stats.js), html is the per-state model.
const baseMon = () => ({
  typeName: "Emberling", name: "Emberling",
  baseHealth: 40, baseStrength: 12, baseDefense: 8, healthScaling1: 2, healthScaling2: 1,
  html: { canvas: 256, base: '<div class="body"><span class="flame">small</span></div>', idle: '<div class="body idle">small</div>' },
});

test("TQ-551 pendingEvolution: fires when crossing the fixed level (30), once, and respects idempotency", () => {
  const L = EVOLUTION_LEVELS[0]; // 30
  const m = baseMon();
  assert.equal(pendingEvolution(m, L - 1, L - 2), null, "not at the fixed level yet");
  assert.equal(pendingEvolution(m, L, L - 1), L, "crossing 30 evolves");
  assert.equal(pendingEvolution(m, L + 5, 1), L, "a multi-level jump still catches the uncrossed fixed level");
  m.evolvedLevels = [L];
  assert.equal(pendingEvolution(m, L + 5, L - 1), null, "already evolved at 30 → no re-fire");
});

test("TQ-551 applyReplaceEdits: exactly-once find/replace; rejects missing, ambiguous, malformed", () => {
  assert.deepEqual(applyReplaceEdits("a-X-b", [{ oldString: "X", newString: "Y" }]), { ok: true, text: "a-Y-b" });
  assert.equal(applyReplaceEdits("abc", [{ oldString: "zzz", newString: "y" }]).error, "not_found");
  assert.equal(applyReplaceEdits("a-X-X-b", [{ oldString: "X", newString: "Y" }]).error, "ambiguous", "ambiguous match is rejected (no silent multi-replace)");
  assert.equal(applyReplaceEdits("abc", [{ oldString: "", newString: "y" }]).error, "empty_old");
  assert.equal(applyReplaceEdits("abc", [{ newString: "y" }]).error, "bad_edit");
  assert.equal(applyReplaceEdits("abc", []).error, "no_edits");
  // sequential edits chain on the running text
  assert.deepEqual(applyReplaceEdits("one two", [{ oldString: "one", newString: "1" }, { oldString: "two", newString: "2" }]), { ok: true, text: "1 2" });
});

test("TQ-551 applyAttrEdits: returns edited fields only; grows but clamps to ≤ double; sets from 0; ignores junk", () => {
  const src = { baseHealth: 40, baseStrength: 12, baseDefense: 0 };
  const out = applyAttrEdits(src, { baseHealth: 60, baseStrength: 999, baseDefense: 5, basePower: 7, baseLuck: "nope" });
  assert.equal(out.baseHealth, 60, "within double → taken as-is");
  assert.equal(out.baseStrength, 12 * EVOLUTION_MAX_GROWTH, "999 clamped to double the base");
  assert.equal(out.baseDefense, 5, "a previously-0 stat can be set");
  assert.equal(out.basePower, 7, "an absent stat can be added");
  assert.equal("baseLuck" in out, false, "non-numeric edit dropped");
  assert.deepEqual(applyAttrEdits(src, undefined), {}, "no edits → empty map");
  assert.deepEqual(applyAttrEdits(src, {}), {}, "empty edits → empty map");
  assert.deepEqual(src, { baseHealth: 40, baseStrength: 12, baseDefense: 0 }, "source not mutated");
});

test("TQ-551 applyEvolution: mutates model + base* stats + name in place, records the level", () => {
  const m = baseMon();
  const res = applyEvolution(m, 30, {
    name: "Emberbeast",
    attrEdits: { baseHealth: 70, baseStrength: 20 },
    modelEdits: {
      base: [{ oldString: "small", newString: "huge blazing" }],
      idle: [{ oldString: "small", newString: "huge blazing" }],
    },
  });
  assert.equal(res.ok, true);
  assert.match(m.html.base, /huge blazing/, "base model edited in place");
  assert.match(m.html.idle, /huge blazing/, "idle state edited too");
  assert.equal(m.name, "Emberbeast", "renamed to the evolved form");
  assert.equal(m.baseHealth, 70); assert.equal(m.baseStrength, 20, "top-level stat fields grown");
  assert.equal(m.healthScaling1, 2, "scaling untouched (growth curve preserved)");
  assert.deepEqual(m.evolvedLevels, [30], "evolution level recorded (idempotency)");
});

test("TQ-551 buildEvolvedType: mints a derived type (unique name, evolved flag) without touching the base", () => {
  const base = baseMon();
  const baseSnapshot = JSON.parse(JSON.stringify(base));
  const res = buildEvolvedType(base, 30, {
    name: "Emberbeast", attrEdits: { baseHealth: 70 },
    modelEdits: { base: [{ oldString: "small", newString: "huge" }] },
  }, { newTypeName: "Emberling#evo30#abc" });
  assert.equal(res.ok, true);
  assert.equal(res.type.typeName, "Emberling#evo30#abc");
  assert.equal(res.type.baseTypeName, "Emberling");
  assert.equal(res.type.evolved, true);
  assert.equal(res.type.baseHealth, 70); assert.match(res.type.html.base, /huge/);
  assert.equal("evolvedLevels" in res.type, false, "evolvedLevels is an instance concern, not on the type");
  assert.deepEqual(base, baseSnapshot, "the base type is untouched (worked on a deep copy)");
  // a rejected evolution (no base edit) propagates the error
  assert.equal(buildEvolvedType(base, 30, { attrEdits: { baseHealth: 50 } }, { newTypeName: "x" }).error, "base_unedited");
  assert.equal(buildEvolvedType(base, 30, { modelEdits: { base: [{ oldString: "small", newString: "x" }] } }, {}).error, "no_name");
});

test("TQ-551 applyEvolution: ATOMIC — a bad state edit rejects the whole evolution, monster untouched", () => {
  const m = baseMon();
  const before = JSON.parse(JSON.stringify(m));
  const res = applyEvolution(m, 15, {
    modelEdits: {
      base: [{ oldString: "small", newString: "huge" }],          // valid
      idle: [{ oldString: "NOT-PRESENT", newString: "x" }],        // invalid → whole thing must roll back
    },
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, "model_idle_not_found");
  assert.deepEqual(m, before, "no partial mutation: base NOT edited, no evolvedLevels, name intact");
});

test("TQ-551 applyEvolution: requires a base edit (no no-op evolutions) and a model to edit", () => {
  const m = baseMon();
  assert.equal(applyEvolution(m, 30, { modelEdits: { idle: [{ oldString: "small", newString: "big" }] } }).error, "base_unedited");
  assert.equal(applyEvolution(m, 30, { attrEdits: { baseHealth: 50 } }).error, "base_unedited", "attr-only is not an evolution");
  assert.equal(applyEvolution({}, 30, { modelEdits: { base: [{ oldString: "a", newString: "b" }] } }).error, "no_model");
  assert.equal(applyEvolution(m, 30, null).error, "no_result");
});

test("TQ-551 applyEvolution: rejects an edit that breaks renderability", () => {
  const m = baseMon();
  // Replace the entire base markup with plain text → not renderable HTML → rejected.
  const res = applyEvolution(m, 30, { modelEdits: { base: [{ oldString: m.html.base, newString: "just words" }] } });
  assert.equal(res.ok, false);
  assert.equal(res.error, "model_base_unrenderable");
});
