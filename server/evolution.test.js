import { test } from "node:test";
import assert from "node:assert/strict";
import { EVOLUTION_LEVELS, EVOLUTION_MAX_GROWTH, pendingEvolution, applyReplaceEdits, applyAttrEdits, applyEvolution } from "./evolution.js";

const baseMon = () => ({
  name: "Emberling",
  attributes: { hp: 40, attack: 12, defense: 8 },
  html: { canvas: 256, base: '<div class="body"><span class="flame">small</span></div>', idle: '<div class="body idle">small</div>' },
});

test("TQ-551 pendingEvolution: fires when crossing a fixed level, once, and respects idempotency", () => {
  const m = baseMon();
  assert.equal(pendingEvolution(m, 14, 13), null, "not at a fixed level yet");
  assert.equal(pendingEvolution(m, 15, 14), EVOLUTION_LEVELS[0], "crossing 15 evolves");
  assert.equal(pendingEvolution(m, 20, 10), 15, "a multi-level jump still catches the lowest uncrossed fixed level");
  m.evolvedLevels = [15];
  assert.equal(pendingEvolution(m, 20, 14), null, "already evolved at 15 → no re-fire");
  assert.equal(pendingEvolution(m, 30, 29), 30, "the next fixed level still fires");
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

test("TQ-551 applyAttrEdits: grows but clamps to ≤ double; sets from 0; ignores junk; attrEdits optional", () => {
  const a = { hp: 40, attack: 12, defense: 0 };
  const out = applyAttrEdits(a, { hp: 60, attack: 999, defense: 5, speed: 7 });
  assert.equal(out.hp, 60, "within double → taken as-is");
  assert.equal(out.attack, 12 * EVOLUTION_MAX_GROWTH, "999 clamped to double the base");
  assert.equal(out.defense, 5, "a previously-0 stat can be set");
  assert.equal(out.speed, 7, "a new stat is added");
  assert.deepEqual(applyAttrEdits(a, undefined), a, "no edits → unchanged copy");
  assert.notEqual(applyAttrEdits(a, {}), a, "returns a fresh object (no mutation of the input)");
});

test("TQ-551 applyEvolution: mutates model + attributes + name in place, records the level", () => {
  const m = baseMon();
  const res = applyEvolution(m, 15, {
    name: "Emberbeast",
    attrEdits: { hp: 70, attack: 20 },
    modelEdits: {
      base: [{ oldString: "small", newString: "huge blazing" }],
      idle: [{ oldString: "small", newString: "huge blazing" }],
    },
  });
  assert.equal(res.ok, true);
  assert.match(m.html.base, /huge blazing/, "base model edited in place");
  assert.match(m.html.idle, /huge blazing/, "idle state edited too");
  assert.equal(m.name, "Emberbeast", "renamed to the evolved form");
  assert.equal(m.attributes.hp, 70); assert.equal(m.attributes.attack, 20);
  assert.deepEqual(m.evolvedLevels, [15], "evolution level recorded (idempotency)");
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
  assert.equal(applyEvolution(m, 15, { modelEdits: { idle: [{ oldString: "small", newString: "big" }] } }).error, "base_unedited");
  assert.equal(applyEvolution(m, 15, { attrEdits: { hp: 50 } }).error, "base_unedited", "attr-only is not an evolution");
  assert.equal(applyEvolution({ attributes: {} }, 15, { modelEdits: { base: [{ oldString: "a", newString: "b" }] } }).error, "no_model");
  assert.equal(applyEvolution(m, 15, null).error, "no_result");
});

test("TQ-551 applyEvolution: rejects an edit that breaks renderability", () => {
  const m = baseMon();
  // Replace the entire base markup with plain text → not renderable HTML → rejected.
  const res = applyEvolution(m, 15, { modelEdits: { base: [{ oldString: m.html.base, newString: "just words" }] } });
  assert.equal(res.ok, false);
  assert.equal(res.error, "model_base_unrenderable");
});
