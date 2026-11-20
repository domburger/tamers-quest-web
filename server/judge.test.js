import { test } from "node:test";
import assert from "node:assert/strict";
import { applyJudgeEdits, resolveSpecial } from "./judge.js";

const mon = () => ({ name: "Test", element: "Fire", currentHealth: 100, maxHealth: 200, currentEnergy: 40, maxEnergy: 80, strength: 50, defense: 50, speed: 30, power: 40, luck: 10, status: null });

test("applyJudgeEdits: integer fields are DELTAS, clamped to [0, max]", () => {
  const m = mon();
  const r = applyJudgeEdits(m, { currentHealth: -40, currentEnergy: 25 });
  assert.equal(r.currentHealth, 60, "HP delta applied (100-40)");
  assert.equal(r.currentEnergy, 65, "energy delta applied (40+25)");
  assert.equal(applyJudgeEdits(m, { currentHealth: 9999 }).currentHealth, 200, "clamped to maxHealth");
  assert.equal(applyJudgeEdits(m, { currentHealth: -9999 }).currentHealth, 0, "clamped to 0");
  assert.equal(applyJudgeEdits(m, { strength: -100 }).strength, 0, "stat debuff clamps at 0");
  assert.equal(applyJudgeEdits(m, { strength: 20 }).strength, 70, "stat buff is a delta");
});

test("applyJudgeEdits: per-turn damage cap limits a single-turn HP loss (task 78)", () => {
  const full = { ...mon(), currentHealth: 200, maxHealth: 200 };
  assert.equal(applyJudgeEdits(full, { currentHealth: -200 }, { maxTurnDamageFrac: 0.4 }).currentHealth, 120, "one-shot capped to an 80-HP loss");
  assert.equal(applyJudgeEdits(full, { currentHealth: -200 }).currentHealth, 0, "no cap by default (frac off) → one-shot lands");
  assert.equal(applyJudgeEdits({ ...mon(), currentHealth: 50, maxHealth: 200 }, { currentHealth: 100 }, { maxTurnDamageFrac: 0.4 }).currentHealth, 150, "a heal is never capped");
  assert.equal(applyJudgeEdits({ ...mon(), currentHealth: 50, maxHealth: 200 }, { currentHealth: -50 }, { maxTurnDamageFrac: 0.4 }).currentHealth, 0, "weakened monster can still die under the cap");
});

test("applyJudgeEdits: status is a full REWRITE (canonicalized), and is pure", () => {
  const m = mon();
  assert.equal(applyJudgeEdits(m, { status: "burning" }).status, "Burn", "status rewritten + normalized");
  assert.equal(applyJudgeEdits({ ...m, status: "Poison" }, { status: null }).status, null, "null clears status");
  assert.equal(applyJudgeEdits({ ...m, status: "Poison" }, { status: "" }).status, null, "empty clears status");
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
  const r = resolveSpecial({ end: true, reason: "a\nb\tc" + "x".repeat(200) });
  assert.ok(!/[\n\t]/.test(r.reason), "control chars stripped");
  assert.ok(r.reason.length <= 80, "reason capped");
});

