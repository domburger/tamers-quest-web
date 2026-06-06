// Account meta-progression — permanent upgrades bought with gold between runs,
// stored on the profile as `upgrades: { [id]: level }`. Pure & framework-agnostic
// (no DOM/engine deps) so client + server + tests share one implementation. The
// effect getters are read at the relevant award/cap sites.

export const UPGRADE_DEFS = [
  { id: "prospector", name: "Prospector", desc: "+20% gold from defeats & extraction, per level.", maxLevel: 5, baseCost: 120, costMult: 1.8, per: 0.20 },
  { id: "attunement", name: "Attunement", desc: "+20% Spirit Essence from defeats & chests, per level.", maxLevel: 5, baseCost: 120, costMult: 1.8, per: 0.20 },
  { id: "deepVault", name: "Deep Vault", desc: "+25 vault capacity, per level.", maxLevel: 5, baseCost: 100, costMult: 1.6, per: 25 },
];

export function getUpgradeDef(id) {
  return UPGRADE_DEFS.find((u) => u.id === id) || null;
}

/** Current owned level of an upgrade (0 if none). */
export function upgradeLevel(profile, id) {
  return (profile && profile.upgrades && profile.upgrades[id]) || 0;
}

/** Gold cost to go from `level` → `level+1`. */
export function upgradeCost(def, level) {
  return Math.round(def.baseCost * Math.pow(def.costMult, level));
}

/** Cost of the player's NEXT level of `def`, or null if maxed. */
export function nextUpgradeCost(profile, def) {
  const lvl = upgradeLevel(profile, def.id);
  return lvl >= def.maxLevel ? null : upgradeCost(def, lvl);
}

/**
 * Buy one level of an upgrade with gold. Returns { ok, reason } — reason is
 * "maxed" | "gold" | "unknown". Mutates the profile; caller persists.
 */
export function purchaseUpgrade(profile, def) {
  if (!def) return { ok: false, reason: "unknown" };
  const lvl = upgradeLevel(profile, def.id);
  if (lvl >= def.maxLevel) return { ok: false, reason: "maxed" };
  const cost = upgradeCost(def, lvl);
  if ((profile.gold || 0) < cost) return { ok: false, reason: "gold" };
  profile.gold -= cost;
  profile.upgrades = profile.upgrades || {};
  profile.upgrades[def.id] = lvl + 1;
  return { ok: true };
}

// ── Effect getters (read at award / cap sites) ──
export function goldMult(profile) { return 1 + 0.20 * upgradeLevel(profile, "prospector"); }
export function essenceMult(profile) { return 1 + 0.20 * upgradeLevel(profile, "attunement"); }
export function vaultCapacity(profile, base) { return base + 25 * upgradeLevel(profile, "deepVault"); }
