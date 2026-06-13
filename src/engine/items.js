// Combat-item model (TQ-64). Items were previously bare {id,name,description} with their effect
// improvised by the AI judge from free text. This adds an OPTIONAL structured layer — a category, a
// rarity tier, and a defined `effect` — so a seeded consumable resolves consistently and the UI can
// show rarity. Pure + framework-agnostic so the authoritative server (combat) and the client (the
// Items tab) share ONE source. Items without these fields (older / un-tagged AI items) still work —
// every helper degrades gracefully to the plain free-text behaviour.

// Rarity tiers, lowest → highest. Shared with the cosmetics rarity vocabulary so the game reads one way.
export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"];

/** An item's rarity tier, defaulting to "common" for un-tagged items. */
export function itemRarity(item) {
  const r = item && typeof item.rarity === "string" ? item.rarity.toLowerCase() : "common";
  return RARITIES.includes(r) ? r : "common";
}

/** An item's category ("consumable" by default — every current combat item is a consumable). */
export function itemCategory(item) {
  return (item && item.category) || "consumable";
}

// A defined effect → a short, explicit combat DIRECTIVE for the AI judge, so a tagged consumable
// applies the SAME way every time instead of being re-improvised from the flavour text. Returns ""
// when the item carries no structured effect (then the judge falls back to the free-text description).
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

// The description handed to the combat judge: the item's flavour text PLUS its structured effect as
// an explicit directive (when defined), so the resolution is consistent. Plain items are unchanged.
export function itemCombatDescription(item) {
  const desc = (item && item.description) || "";
  const eff = itemEffectText(item);
  return eff ? `${desc} (Effect: ${eff}.)`.trim() : desc;
}

// TQ-65: per-rarity DROP weight — the relative chance an item of each tier is the one a source yields.
// Commons dominate; legendaries are scarce. Tunable balance lever (the economy work can revisit these).
export const RARITY_DROP_WEIGHT = { common: 50, uncommon: 28, rare: 14, epic: 6, legendary: 2 };

// Pick ONE item from `pool`, weighted by rarity (rarer → less likely), from a single 0..1 `rnd` (the
// seeded round RNG) so drops stay reproducible. Returns null for an empty pool. Un-tagged items count
// as common (via itemRarity), so they still drop at the base rate.
export function rollItemFromPool(pool, rnd) {
  if (!pool || !pool.length) return null;
  const weights = pool.map((it) => RARITY_DROP_WEIGHT[itemRarity(it)] || RARITY_DROP_WEIGHT.common);
  const total = weights.reduce((a, w) => a + w, 0);
  let t = Math.max(0, Math.min(1, rnd)) * total;
  for (let i = 0; i < pool.length; i++) { t -= weights[i]; if (t < 0) return pool[i]; }
  return pool[pool.length - 1]; // float-rounding safety
}
