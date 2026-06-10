// Pure Spirit Chain math — framework-agnostic, no fetch/DOM/imports so the
// client, server, and engine all share ONE implementation. GAME tunables are
// passed in by the caller (see GAME.SPIRIT_CHAIN in schemas.js).

/**
 * Final capture chance for a chain attempt.
 * - "guaranteed" specials succeed (≈1) once the target is sufficiently weakened.
 * - A chain cannot capture monsters above its `maxRarity` (auto-fail → 0).
 * - Otherwise the chain's `captureMultiplier` scales the engine's base chance,
 *   clamped to the usual .95 ceiling.
 * @param {number} baseChance      Engine HP/status base chance (0..1).
 * @param {{special?:?string, maxRarity?:number, captureMultiplier?:number}} chain
 * @param {number} enemyRarity     Target MonsterType.rarity (1..5).
 * @param {number} enemyHpPct      Target current HP fraction (0..1).
 * @param {object} GAME            schemas.GAME (reads GAME.SPIRIT_CHAIN).
 * @returns {number} chance 0..1
 */
export function chainCaptureChance(baseChance, chain, enemyRarity, enemyHpPct, GAME) {
  if (chain.special === "guaranteed" && enemyHpPct <= GAME.SPIRIT_CHAIN.GUARANTEED_HP_PCT) {
    return 0.999;
  }
  if (enemyRarity > (chain.maxRarity ?? Infinity)) return 0; // rarity gate → auto-fail
  const mult = chain.captureMultiplier ?? 1;
  return Math.min(0.95, Math.max(0, baseChance * mult));
}

/**
 * A short, human-readable catch-feasibility summary for an inspect panel: can the
 * equipped `chain` catch a monster of `monsterRarity`, and at what multiplier?
 * Spirit chains are element-agnostic — they gate by `maxRarity` and scale by
 * `captureMultiplier` (there is no element affinity), so this is the accurate
 * "will my chain work on this" readout (INV-T3). Pure, ASCII-only (glyph guardrail).
 * @param {?{name?:string, special?:?string, maxRarity?:number, captureMultiplier?:number}} chain
 * @param {number} monsterRarity  the target MonsterType.rarity (1..5)
 * @returns {{ ok:boolean, text:string }}
 */
export function chainCatchSummary(chain, monsterRarity) {
  if (!chain) return { ok: false, text: "No chain equipped" };
  if (chain.special === "guaranteed") return { ok: true, text: "Guaranteed once weakened" };
  if (monsterRarity > (chain.maxRarity ?? Infinity)) {
    return { ok: false, text: `Rarity too high (chain catches up to ${chain.maxRarity})` };
  }
  return { ok: true, text: `Can catch (${chain.captureMultiplier ?? 1}x base)` };
}

/**
 * Whether a chain instance can be thrown. Overworld throws are FREE — a thrown chain
 * boomerangs back to the tamer and is only spent (a `durability` charge) on a battle
 * capture (user 2026-06-10) — so a chain is throwable as long as it still has capture
 * charges left (`durability > 0`). A depleted chain is removed from the inventory, so
 * in practice any owned chain is throwable; this guards a malformed/empty entry.
 * @param {{durability:?number}} chainState
 * @returns {boolean}
 */
export function canThrow(chainState) {
  return !!chainState && (chainState.durability == null || chainState.durability > 0);
}

/**
 * The "multi/area" chain's cluster: the nearest `max` candidates within `radius`
 * world-px of `origin`, closest first. Caller passes candidates already excluding
 * the primary target; each item needs numeric x/y. Pure + framework-agnostic.
 * @param {{x:number,y:number}} origin
 * @param {Array<{x:number,y:number}>} candidates
 * @param {number} radius
 * @param {number} max
 * @returns {Array} subset of candidates
 */
export function clusterTargets(origin, candidates, radius, max) {
  const r2 = radius * radius;
  return (candidates || [])
    .map((c) => ({ c, d: (c.x - origin.x) ** 2 + (c.y - origin.y) ** 2 }))
    .filter((e) => e.d <= r2)
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.max(0, max))
    .map((e) => e.c);
}

/**
 * Pick a chain definition for an in-run loot drop, weighted by each chain's
 * `dropWeight` (0 / missing = never drops naturally). Returns the def, or null
 * if nothing is droppable.
 * @param {Array<{dropWeight?:number}>} defs  all chain definitions
 * @param {{next:()=>number}} rng             makeRng() instance (or {next})
 */
export function rollChainDrop(defs, rng) {
  const pool = (defs || []).filter((d) => (d.dropWeight || 0) > 0);
  const total = pool.reduce((s, d) => s + d.dropWeight, 0);
  if (total <= 0) return null;
  let r = rng.next() * total;
  for (const d of pool) {
    r -= d.dropWeight;
    if (r < 0) return d;
  }
  return pool[pool.length - 1];
}
