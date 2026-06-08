// Square play-window geometry (user design decision 2026-06-08: "make the in-game
// window a square, with the map shown outside it depending on resolution; enable
// portrait formats").
//
// The in-round camera fills the whole canvas, so the world map is drawn across the
// entire viewport. On top of that we define a centered SQUARE "play window" — the
// canonical play area — and treat the area *outside* it as peripheral map context
// (kept visible, gently dimmed so the square reads as the focus). Because the window
// is always a centered square of side min(W,H), the SAME geometry works in landscape
// (extra map left/right) AND portrait (extra map top/bottom) — which is what lets us
// turn on portrait without a separate layout. HUD anchors to this rect (not the raw
// canvas edges) so it stays consistent across every aspect ratio.
//
// Pure geometry (no engine import) so it's unit-testable and reusable by every scene.

// The centered square play window for a W×H design viewport.
// `margin` insets the square from the smaller edge (so the frame isn't flush). Returns
// { x, y, size, cx, cy, right, bottom } in design units.
export function playWindowRect(W, H, { margin = 0 } = {}) {
  const size = Math.max(0, Math.min(W, H) - margin * 2);
  const x = Math.round((W - size) / 2);
  const y = Math.round((H - size) / 2);
  return { x, y, size, cx: x + size / 2, cy: y + size / 2, right: x + size, bottom: y + size };
}

// Draw the play-window framing: a soft dim over the peripheral map (the bands outside
// the square) + a thin frame line around the square. Additive overlay — drawn over the
// world, under the HUD. `dim` = peripheral darkening (0 = off). All `fixed` (screen
// space). No-op-safe: when the square fills the viewport (square aspect) the bands have
// zero area, so nothing is drawn.
export function drawPlayWindow(k, { margin = 0, dim = 0.28, frame = true, frameColor = [120, 150, 170], frameOpacity = 0.35 } = {}) {
  const W = k.width(), H = k.height();
  const r = playWindowRect(W, H, { margin });
  const black = k.rgb(8, 8, 12);
  if (dim > 0) {
    // Peripheral bands: left/right (landscape) or top/bottom (portrait). Only one pair
    // has area for a given aspect; the other is zero-width and draws nothing.
    if (r.x > 0) {
      k.drawRect({ pos: k.vec2(0, 0), width: r.x, height: H, color: black, opacity: dim, fixed: true });
      k.drawRect({ pos: k.vec2(r.right, 0), width: W - r.right, height: H, color: black, opacity: dim, fixed: true });
    }
    if (r.y > 0) {
      k.drawRect({ pos: k.vec2(0, 0), width: W, height: r.y, color: black, opacity: dim, fixed: true });
      k.drawRect({ pos: k.vec2(0, r.bottom), width: W, height: H - r.bottom, color: black, opacity: dim, fixed: true });
    }
  }
  if (frame && r.size > 0) {
    const fc = k.rgb(frameColor[0], frameColor[1], frameColor[2]), t = 2;
    k.drawRect({ pos: k.vec2(r.x, r.y), width: r.size, height: t, color: fc, opacity: frameOpacity, fixed: true });
    k.drawRect({ pos: k.vec2(r.x, r.bottom - t), width: r.size, height: t, color: fc, opacity: frameOpacity, fixed: true });
    k.drawRect({ pos: k.vec2(r.x, r.y), width: t, height: r.size, color: fc, opacity: frameOpacity, fixed: true });
    k.drawRect({ pos: k.vec2(r.right - t, r.y), width: t, height: r.size, color: fc, opacity: frameOpacity, fixed: true });
  }
  return r;
}
