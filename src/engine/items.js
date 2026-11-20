export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"];

export function itemRarity(item) {
  const r = item && typeof item.rarity === "string" ? item.rarity.toLowerCase() : "common";
  return RARITIES.includes(r) ? r : "common";
}

const MAG = { small: "a small amount of", big: "a large amount of" };
export function itemEffectText(item) {
  const e = item && item.effect;
  if (!e || !e.kind) return "";
  const self = "the USER's own active monster", enemy = "the ENEMY monster";
  const who = e.target === "enemy" ? enemy : self;
  const mag = MAG[e.magnitude] || "a moderate amount of";
  switch (e.kind) {
    case "heal": return `restore ${mag} ${who}'s HP`;
    case "energy": return `restore ${mag} ${who}'s energy`;
    case "cleanse": return `cure ${who}'s status ailment (burn/poison/freeze/etc.)`;
    case "buff": return `raise ${who}'s ${e.stat || "defense"} for a few turns`;
    case "damage": return `deal direct damage to ${who}`;
    case "debuff": return `lower ${who}'s ${e.stat || "defense"} / hinder it`;
    case "status": return `inflict a status ailment (burn/poison/freeze) on ${who}`;
    default: return "";
  }
}

export function itemCombatDescription(item) {
  const desc = (item && item.description) || "";
  const eff = itemEffectText(item);
  return eff ? `${desc} (Effect: ${eff}.)`.trim() : desc;
}

export const RARITY_DROP_WEIGHT = { common: 50, uncommon: 28, rare: 14, epic: 6, legendary: 2 };

export function rollItemFromPool(pool, rnd) {
  if (!pool || !pool.length) return null;
  const weights = pool.map((it) => RARITY_DROP_WEIGHT[itemRarity(it)] || RARITY_DROP_WEIGHT.common);
  const total = weights.reduce((a, w) => a + w, 0);
  let t = Math.max(0, Math.min(1, rnd)) * total;
  for (let i = 0; i < pool.length; i++) { t -= weights[i]; if (t < 0) return pool[i]; }
  return pool[pool.length - 1];
}
