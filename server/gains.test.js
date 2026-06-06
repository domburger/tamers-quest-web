// P8-T3 round-end gains summary (@visual). Server delta math + client wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRunGains } from "./world.js";
import { applyMessage } from "../src/net.js";

test("computeRunGains: per-run caught/XP/level/survival deltas", () => {
  const s = {
    runStart: { caught: 2, xp: 100, levels: 8, at: Date.now() - 5000 },
    profile: { stats: { caught: 5 }, activeMonsters: [{ xp: 80, level: 6 }, { xp: 60, level: 5 }] },
  };
  const g = computeRunGains(s);
  assert.equal(g.caught, 3);    // 5 - 2
  assert.equal(g.xpGained, 40); // (80+60) - 100
  assert.equal(g.levelUps, 3);  // (6+5) - 8
  assert.ok(g.survivedS >= 4 && g.survivedS <= 7);
});

test("computeRunGains: no runStart → all zeros", () => {
  assert.deepEqual(computeRunGains({ profile: { activeMonsters: [] } }), { caught: 0, xpGained: 0, levelUps: 0, survivedS: 0 });
});

test("computeRunGains: deltas clamp at 0 (e.g. death swapped in a weaker team)", () => {
  const s = { runStart: { caught: 5, xp: 200, levels: 10, at: Date.now() }, profile: { stats: { caught: 5 }, activeMonsters: [{ xp: 0, level: 1 }] } };
  const g = computeRunGains(s);
  assert.equal(g.caught, 0);
  assert.equal(g.xpGained, 0);
  assert.equal(g.levelUps, 0);
});

test("extracted/died carry per-run gains to roundResult (null when absent)", () => {
  const s = { roundResult: null };
  applyMessage(s, { t: "extracted", reason: "extracted", gains: { caught: 2, xpGained: 30, levelUps: 1, survivedS: 90 } });
  assert.equal(s.roundResult.outcome, "extracted");
  assert.equal(s.roundResult.gains.caught, 2);
  assert.equal(s.roundResult.gains.xpGained, 30);

  const s2 = { roundResult: null };
  applyMessage(s2, { t: "died", reason: "zone" });
  assert.equal(s2.roundResult.gains, null); // missing gains → null, no crash
});
