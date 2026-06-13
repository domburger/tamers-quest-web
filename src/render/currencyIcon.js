// Currency icons (TQ-138): one distinct, theme-matched icon per currency — GOLD (earned, a round
// coin) and ESSENCE (premium/paid, a faceted gem) — drawn immediate-mode (call inside onDraw) so
// they work anywhere amounts are shown (the shared drawCurrency component, shop, hub, roster,
// wallet). Pure render — reads a currency `kind` + its tint colour and draws a small badge sized to
// the existing pip footprint, so callers gain a SHAPED icon with no layout change. Crisp at small
// sizes; uses only the confirmed shim primitives (circle / ellipse / line) — no polygon / rotation.

// Shift an [r,g,b] toward white / black by t (0..1) — for the rim + facet highlights.
function lighten(c, t) { return [c[0] + (255 - c[0]) * t, c[1] + (255 - c[1]) * t, c[2] + (255 - c[2]) * t]; }
function darken(c, t) { return [c[0] * (1 - t), c[1] * (1 - t), c[2] * (1 - t)]; }

/**
 * Draw a currency icon, centred at (x,y), sized to radius r. Immediate-mode — call every frame.
 * @param k compat/kaboom ctx
 * @param kind "gold" | "essence" (an unknown kind → a plain tinted dot, so callers never break)
 * @param {object} o { x, y, r?=4, color?:[r,g,b], fixed?=true }  x,y = icon CENTRE
 */
export function drawCurrencyIcon(k, kind, o = {}) {
  const x = o.x || 0, y = o.y || 0, r = o.r || 4, fixed = o.fixed !== false;
  const base = Array.isArray(o.color) ? o.color : [200, 200, 210];
  const lite = lighten(base, 0.5), dark = darken(base, 0.35);

  if (kind === "gold") {
    // A round coin: amber disc + a darker struck rim + a bright shine — reads as minted metal.
    k.drawCircle({ pos: k.vec2(x, y), radius: r, color: k.rgb(base[0], base[1], base[2]), fixed });
    k.drawCircle({ pos: k.vec2(x, y), radius: r, fill: false, outline: { width: Math.max(1, r * 0.28), color: k.rgb(dark[0], dark[1], dark[2]) }, fixed });
    k.drawCircle({ pos: k.vec2(x - r * 0.3, y - r * 0.32), radius: Math.max(0.8, r * 0.26), color: k.rgb(lite[0], lite[1], lite[2]), fixed });
  } else if (kind === "essence") {
    // A faceted gem: a tall body (radiusX < radiusY) + a crystalline crown (two facet lines meeting
    // at the apex) + a table highlight — an angular silhouette distinct from the round coin at ~8px.
    k.drawEllipse({ pos: k.vec2(x, y + r * 0.1), radiusX: r * 0.72, radiusY: r, color: k.rgb(base[0], base[1], base[2]), fixed });
    const apex = k.vec2(x, y - r);
    k.drawLine({ p1: apex, p2: k.vec2(x - r * 0.72, y), width: Math.max(1, r * 0.22), color: k.rgb(lite[0], lite[1], lite[2]), fixed });
    k.drawLine({ p1: apex, p2: k.vec2(x + r * 0.72, y), width: Math.max(1, r * 0.22), color: k.rgb(lite[0], lite[1], lite[2]), fixed });
    k.drawLine({ p1: k.vec2(x - r * 0.5, y - r * 0.1), p2: k.vec2(x + r * 0.5, y - r * 0.1), width: Math.max(1, r * 0.18), color: k.rgb(lite[0], lite[1], lite[2]), fixed });
  } else {
    // Unknown currency → the original plain tinted dot, so a future kind degrades gracefully.
    k.drawCircle({ pos: k.vec2(x, y), radius: r, color: k.rgb(base[0], base[1], base[2]), fixed });
  }
}
