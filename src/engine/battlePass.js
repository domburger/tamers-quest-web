// Battle pass — season + tier MODEL (TQ-181 / story TQ-172). Pure + data-driven: the SERVER owns each
// player's bpXp + claimed tiers (TQ-182/183); this module only defines the season's shape and the pure
// helpers over it (which tier an XP total is at, XP to the next tier, the reward at a tier/track).
//
// Rewards are NON-PAY-TO-WIN by hard rule: only cosmetics, gold, essence, or spirit chains — never
// stats/power. A reward is { kind: "gold"|"essence"|"cosmetic"|"chain", amount?, id? }. The claim
// handler (TQ-183) maps each kind to an existing grant system (gold field, grantEssence, buy/own a
// cosmetic, grantChain). SEASON_1 ships gold (free track) + essence (premium track) so every reward is
// always valid to grant without coupling the season to specific content ids; cosmetic/chain tiers can
// be added later by id (the schema already supports them). Amounts + the XP curve are intentionally
// TUNABLE — this sub-task fixes the STRUCTURE, product can adjust the numbers.

export const BP_TIERS = 30;                                                  // tiers per season
export const BP_REWARD_KINDS = Object.freeze(["gold", "essence", "cosmetic", "chain"]); // non-P2W only

// Cumulative BP-XP required to REACH tier t (1-based), from 0. Closed form of sum_{i=1..t}(80 + 20i):
//   80t + 10t(t+1).   tier 1 = 100, tier 2 = 220, … tier 30 = 11,700 (a ~month-long season).
export function xpForTier(tier) {
  const t = Math.max(0, Math.floor(Number(tier) || 0));
  return 80 * t + 10 * t * (t + 1);
}

// The tier a given total XP sits at (0 = not yet tier 1), capped at BP_TIERS.
export function tierForXp(xp) {
  const x = Math.max(0, Number(xp) || 0);
  let t = 0;
  while (t < BP_TIERS && xpForTier(t + 1) <= x) t++;
  return t;
}

// XP still needed to reach the next tier, or null once the final tier is reached.
export function xpToNextTier(xp) {
  const x = Math.max(0, Number(xp) || 0);
  const t = tierForXp(x);
  return t >= BP_TIERS ? null : xpForTier(t + 1) - x;
}

// Per-tier rewards (TUNABLE). Free track = gold scaling with depth; premium track = essence (a chunk
// on every 5th milestone tier, a small trickle otherwise). Both kinds are always-valid to grant.
function freeRewardFor(tier) { return { kind: "gold", amount: 50 + tier * 10 }; }
function premiumRewardFor(tier) { return { kind: "essence", amount: tier % 5 === 0 ? 50 : 15 }; }

// SEASON_1 — the active season. `id` drives progress reset on rollover (TQ-182); durationDays is
// product-tunable. Each tier carries its cumulative XP threshold + the free/premium reward.
export const SEASON = Object.freeze({
  id: "s1",
  name: "Season 1",
  durationDays: 30,
  tiers: Object.freeze(Array.from({ length: BP_TIERS }, (_, i) => {
    const tier = i + 1;
    return Object.freeze({ tier, xp: xpForTier(tier), free: Object.freeze(freeRewardFor(tier)), premium: Object.freeze(premiumRewardFor(tier)) });
  })),
});

// The reward at a tier (1-based) on a track ("free" | "premium"), or null if the tier is out of range.
export function rewardAt(tier, track) {
  const t = SEASON.tiers[Math.floor(Number(tier) || 0) - 1];
  if (!t) return null;
  return track === "premium" ? t.premium : t.free;
}

// Whether a 1-based tier index has been REACHED for a given XP total (i.e. it is claimable). Bounds-safe.
export function isTierReached(tier, xp) {
  const n = Math.floor(Number(tier) || 0);
  return n >= 1 && n <= BP_TIERS && tierForXp(xp) >= n;
}
