import { test } from "node:test";
import assert from "node:assert/strict";
import { applyJudgeEdits, resolveSpecial, JUDGE_V2_SCHEMA } from "./judge.js";

const mon = () => ({ name: "Test", element: "Fire", currentHealth: 100, maxHealth: 200, currentEnergy: 40, maxEnergy: 80, strength: 50, defense: 50, speed: 30, power: 40, luck: 10, status: null });

test("applyJudgeEdits: integer fields are DELTAS, clamped to [0, max]", () => {
  const m = mon();
  const r = applyJudgeEdits(m, { currentHealth: -40, currentEnergy: 25 });
  assert.equal(r.currentHealth, 60, "HP delta applied (100-40)");
  assert.equal(r.currentEnergy, 65, "energy delta applied (40+25)");
  // over-heal / over-drain clamps to bounds, never negative or over max
  assert.equal(applyJudgeEdits(m, { currentHealth: 9999 }).currentHealth, 200, "clamped to maxHealth");
  assert.equal(applyJudgeEdits(m, { currentHealth: -9999 }).currentHealth, 0, "clamped to 0");
  assert.equal(applyJudgeEdits(m, { strength: -100 }).strength, 0, "stat debuff clamps at 0");
  assert.equal(applyJudgeEdits(m, { strength: 20 }).strength, 70, "stat buff is a delta");
});

test("applyJudgeEdits: status is a full REWRITE (canonicalized), and is pure", () => {
  const m = mon();
  assert.equal(applyJudgeEdits(m, { status: "burning" }).status, "Burn", "status rewritten + normalized");
  assert.equal(applyJudgeEdits({ ...m, status: "Poison" }, { status: null }).status, null, "null clears status");
  assert.equal(applyJudgeEdits({ ...m, status: "Poison" }, { status: "" }).status, null, "empty clears status");
  // unknown fields ignored; original is never mutated
  const before = JSON.stringify(m);
  const r = applyJudgeEdits(m, { name: "HACKED", element: "Void", bogus: 1, currentHealth: -10 });
  assert.equal(r.name, "Test", "identity fields are not rewritable");
  assert.equal(r.element, "Fire");
  assert.equal(JSON.stringify(m), before, "input is not mutated (pure)");
});

test("applyJudgeEdits: tolerates junk edits", () => {
  const m = mon();
  assert.deepEqual(applyJudgeEdits(m, null), m);
  assert.deepEqual(applyJudgeEdits(m, "nope"), m);
  assert.equal(applyJudgeEdits(m, { currentHealth: "lots" }).currentHealth, 100, "non-numeric delta ignored");
});

test("resolveSpecial: end/winner/flee/instaWin normalize safely", () => {
  assert.deepEqual(resolveSpecial(), { end: false, winner: null, flee: false, reason: "" });
  assert.equal(resolveSpecial({ endBattle: true }).end, true);
  assert.deepEqual({ ...resolveSpecial({ winner: "ENEMY" }) }, { end: true, winner: "enemy", flee: false, reason: "" });
  assert.equal(resolveSpecial({ instaWin: true }).winner, "player", "instaWin defaults the winner to player");
  const fl = resolveSpecial({ flee: true });
  assert.ok(fl.end && fl.flee);
  assert.equal(resolveSpecial({ winner: "nonsense" }).winner, null, "an invalid winner is dropped");
  // reason is control-char-stripped + capped
  const r = resolveSpecial({ end: true, reason: "a\nb\tc" + "x".repeat(200) });
  assert.ok(!/[\n\t]/.test(r.reason), "control chars stripped");
  assert.ok(r.reason.length <= 80, "reason capped");
});

test("JUDGE_V2_SCHEMA shape: per-monster edit objects + display + special", () => {
  assert.equal(JUDGE_V2_SCHEMA.type, "object");
  for (const k of ["playerEdits", "enemyEdits", "display", "special"]) assert.ok(JUDGE_V2_SCHEMA.properties[k], `${k} in schema`);
  assert.ok(JUDGE_V2_SCHEMA.required.includes("display"));
});
