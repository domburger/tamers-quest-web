export const BP_TIERS = 30;
export const BP_REWARD_KINDS = Object.freeze(["gold", "essence", "cosmetic", "chain"]);

export function xpForTier(tier) {
  const t = Math.max(0, Math.floor(Number(tier) || 0));
  return 80 * t + 10 * t * (t + 1);
}

export function tierForXp(xp) {
  const x = Math.max(0, Number(xp) || 0);
  let t = 0;
  while (t < BP_TIERS && xpForTier(t + 1) <= x) t++;
  return t;
}

export function xpToNextTier(xp) {
  const x = Math.max(0, Number(xp) || 0);
  const t = tierForXp(x);
  return t >= BP_TIERS ? null : xpForTier(t + 1) - x;
}

function freeRewardFor(tier) { return { kind: "gold", amount: 50 + tier * 10 }; }
function premiumRewardFor(tier) { return { kind: "essence", amount: tier % 5 === 0 ? 50 : 15 }; }

// Changing SEASON.id resets every player's battle-pass progress.
export const SEASON = Object.freeze({
  id: "s1",
  name: "Season 1",
  durationDays: 30,
  tiers: Object.freeze(Array.from({ length: BP_TIERS }, (_, i) => {
    const tier = i + 1;
    return Object.freeze({ tier, xp: xpForTier(tier), free: Object.freeze(freeRewardFor(tier)), premium: Object.freeze(premiumRewardFor(tier)) });
  })),
});

export function rewardAt(tier, track) {
  const t = SEASON.tiers[Math.floor(Number(tier) || 0) - 1];
  if (!t) return null;
  return track === "premium" ? t.premium : t.free;
}

export function isTierReached(tier, xp) {
  const n = Math.floor(Number(tier) || 0);
  return n >= 1 && n <= BP_TIERS && tierForXp(xp) >= n;
}
