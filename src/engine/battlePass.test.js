import { test } from "node:test";
import assert from "node:assert/strict";
import { BP_TIERS, BP_REWARD_KINDS, SEASON, xpForTier, tierForXp, xpToNextTier, rewardAt, isTierReached } from "./battlePass.js";

test("TQ-181: xpForTier is 0 at tier 0, ramps, and is strictly increasing", () => {
  assert.equal(xpForTier(0), 0);
  assert.equal(xpForTier(1), 100); // 80*1 + 10*1*2
  assert.equal(xpForTier(2), 220); // 80*2 + 10*2*3
  for (let t = 1; t <= BP_TIERS; t++) assert.ok(xpForTier(t) > xpForTier(t - 1), `tier ${t} > ${t - 1}`);
});

test("TQ-181: tierForXp maps XP to the reached tier, capped at BP_TIERS", () => {
  assert.equal(tierForXp(0), 0);
  assert.equal(tierForXp(99), 0);
  assert.equal(tierForXp(100), 1);
  assert.equal(tierForXp(219), 1);
  assert.equal(tierForXp(220), 2);
  assert.equal(tierForXp(xpForTier(BP_TIERS)), BP_TIERS);
  assert.equal(tierForXp(99_999_999), BP_TIERS); // cap
  assert.equal(tierForXp(-5), 0);                 // guards negatives
});

test("TQ-181: xpToNextTier is the remaining XP, null at the final tier", () => {
  assert.equal(xpToNextTier(0), 100);
  assert.equal(xpToNextTier(100), 120); // 220 - 100
  assert.equal(xpToNextTier(xpForTier(BP_TIERS)), null);
});

test("TQ-181: SEASON has BP_TIERS tiers; every reward is non-pay-to-win", () => {
  assert.equal(SEASON.tiers.length, BP_TIERS);
  assert.equal(SEASON.id, "s1");
  for (const t of SEASON.tiers) {
    for (const r of [t.free, t.premium]) {
      assert.ok(r && BP_REWARD_KINDS.includes(r.kind), `tier ${t.tier} reward kind ${r && r.kind}`);
      // hard rule: never grant stats/power via the pass
      assert.ok(!["strength", "defense", "speed", "power", "luck", "stat", "level"].includes(r.kind));
    }
    assert.equal(t.xp, xpForTier(t.tier));
  }
});

test("TQ-181: rewardAt resolves per track and is bounds-safe", () => {
  assert.deepEqual(rewardAt(1, "free"), { kind: "gold", amount: 60 });
  assert.deepEqual(rewardAt(5, "premium"), { kind: "essence", amount: 50 });   // milestone
  assert.deepEqual(rewardAt(3, "premium"), { kind: "essence", amount: 15 });   // trickle
  assert.equal(rewardAt(0, "free"), null);
  assert.equal(rewardAt(BP_TIERS + 1, "free"), null);
});

test("TQ-181: isTierReached gates claims correctly", () => {
  assert.equal(isTierReached(1, 100), true);
  assert.equal(isTierReached(2, 100), false);
  assert.equal(isTierReached(0, 100), false);
  assert.equal(isTierReached(BP_TIERS + 1, 99_999_999), false);
});
