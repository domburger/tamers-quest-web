// Spirit-chain TIER icons (TQ-142): one distinct, theme-matched icon per chain tier, drawn
// immediate-mode (call inside onDraw) so it works anywhere chains appear (shop, Items tab, loadout,
// in-run HUD). Pure render — reads a chain def (tier, color, special) and draws a small badge: a
// chain-link glyph in the tier's colour, ringed brighter as the tier rises, with `tier` pips below
// and a special accent (endless / guaranteed / multi) for the tier-6 chains. Crisp at small sizes;
// no game-state/data changes. Landed additively; callers pass {x,y,size}.
//
// Tier→rarity colour is the chain's own `color` (spiritchains.json); higher tiers read richer via a
// brighter rim + a soft glow, so the set conveys power progression at a glance.

// Lighten an [r,g,b] toward white by t (0..1).
function lighten(c, t) {
  return [c[0] + (255 - c[0]) * t, c[1] + (255 - c[1]) * t, c[2] + (255 - c[2]) * t];
}

/**
 * Draw a chain-tier icon. Immediate-mode — call every frame inside onDraw.
 * @param k kaboom/compat ctx
 * @param chain a spirit-chain def ({ tier:1..6, color:[r,g,b], special?:"endless"|"guaranteed"|"multi" })
 * @param {object} o { x, y, size?=28, fixed?=true }  x,y = icon CENTRE
 */
export function drawChainTierIcon(k, chain, o = {}) {
  if (!chain) return;
  const x = o.x || 0, y = o.y || 0, size = o.size || 28, fixed = o.fixed !== false;
  const tier = Math.max(1, Math.min(6, chain.tier || 1));
  const col = Array.isArray(chain.color) ? chain.color : [150, 150, 160];
  const rim = lighten(col, 0.45);
  const r = size / 2;

  // Soft tier glow behind the badge — stronger for higher tiers (power read).
  const glow = Math.min(0.5, 0.1 + tier * 0.06);
  k.drawCircle({ pos: k.vec2(x, y), radius: r * 1.05, color: k.rgb(col[0], col[1], col[2]), opacity: glow, fixed });

  // Two interlocking chain LINKS (oval rings) in the tier colour — the core "chain" glyph.
  const lw = Math.max(2, size * 0.13); // ring thickness
  const lrx = r * 0.5, lry = r * 0.72;
  for (const dx of [-r * 0.28, r * 0.28]) {
    k.drawEllipse({ pos: k.vec2(x + dx, y - r * 0.18), radiusX: lrx, radiusY: lry, fill: false, outline: { width: lw, color: k.rgb(rim[0], rim[1], rim[2]) }, fixed });
  }

  // Tier pips along the bottom — 1..tier small dots, so the exact tier is countable.
  const pipR = Math.max(1.2, size * 0.055);
  const gap = pipR * 2.4;
  const startX = x - (gap * (tier - 1)) / 2;
  for (let i = 0; i < tier; i++) {
    k.drawCircle({ pos: k.vec2(startX + i * gap, y + r * 0.78), radius: pipR, color: k.rgb(rim[0], rim[1], rim[2]), fixed });
  }

  // Special accent for the tier-6 chains so they read as distinct, not just "tier 6".
  if (chain.special === "endless") {
    // an extra orbiting ring (never-ending)
    k.drawCircle({ pos: k.vec2(x, y - r * 0.18), radius: r * 0.92, fill: false, outline: { width: Math.max(1, lw * 0.5), color: k.rgb(rim[0], rim[1], rim[2]) }, fixed });
  } else if (chain.special === "guaranteed") {
    // a crown-like top mark (authority)
    k.drawCircle({ pos: k.vec2(x, y - r * 0.92), radius: pipR * 1.6, color: k.rgb(255, 240, 200), fixed });
  } else if (chain.special === "multi") {
    // a third link (many-headed)
    k.drawEllipse({ pos: k.vec2(x, y - r * 0.18), radiusX: lrx, radiusY: lry, fill: false, outline: { width: lw, color: k.rgb(rim[0], rim[1], rim[2]) }, fixed });
  }
}
