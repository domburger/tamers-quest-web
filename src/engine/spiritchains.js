// Pure: shared by client, server and engine. No DOM, fetch or imports.

export function canThrow(chainState) {
  return !!chainState && (chainState.durability == null || chainState.durability > 0);
}

export function clusterTargets(origin, candidates, radius, max) {
  const r2 = radius * radius;
  return (candidates || [])
    .map((c) => ({ c, d: (c.x - origin.x) ** 2 + (c.y - origin.y) ** 2 }))
    .filter((e) => e.d <= r2)
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.max(0, max))
    .map((e) => e.c);
}

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
