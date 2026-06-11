// Pure Spirit Chain math — framework-agnostic, no fetch/DOM/imports so the
// client, server, and engine all share ONE implementation. GAME tunables are
// passed in by the caller (see GAME.SPIRIT_CHAIN in schemas.js).

// NOTE: capture resolution no longer lives here. The old chainCaptureChance (rarity
// gate + captureMultiplier × HP-fraction formula) and chainCatchSummary (rarity-based
// feasibility readout) were removed when catching became AI-evaluated — each chain now
// carries a `catchPrompt` and the server judge (server/ai.js → aiResolveCatch) decides,
// with no rarity restriction or formula. The throw/loot helpers below remain pure shared math.

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
