// Pure: shared by client, server and tests. No DOM or engine deps.

export const UPGRADE_DEFS = [
  { id: "prospector", name: "Prospector", desc: "+20% gold from defeats & extraction, per level.", maxLevel: 5, baseCost: 120, costMult: 1.8, per: 0.20 },
  { id: "deepVault", name: "Deep Vault", desc: "+25 vault capacity, per level.", maxLevel: 5, baseCost: 100, costMult: 1.6, per: 25 },
];

export function getUpgradeDef(id) {
  return UPGRADE_DEFS.find((u) => u.id === id) || null;
}

export function upgradeLevel(profile, id) {
  return (profile && profile.upgrades && profile.upgrades[id]) || 0;
}

export function upgradeCost(def, level) {
  return Math.round(def.baseCost * Math.pow(def.costMult, level));
}

export function nextUpgradeCost(profile, def) {
  const lvl = upgradeLevel(profile, def.id);
  return lvl >= def.maxLevel ? null : upgradeCost(def, lvl);
}

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

const perOf = (id) => getUpgradeDef(id)?.per ?? 0;
export function goldMult(profile) { return 1 + perOf("prospector") * upgradeLevel(profile, "prospector"); }
export function vaultCapacity(profile, base) { return base + perOf("deepVault") * upgradeLevel(profile, "deepVault"); }
