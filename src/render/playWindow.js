// Square play-window geometry (user design decision 2026-06-08: "make the in-game
// window a square … enable portrait formats"; extended 2026-06-09: "the world must show
// ONLY inside the square — the area outside it must NOT show the world, and it should
// host the minimap, team overview, and touch controls").
//
// The in-round camera fills the whole canvas, so the world is drawn across the entire
// viewport. We define a centered SQUARE "play window" — the canonical play area — and
// fully OCCLUDE everything outside it with opaque "bezel" bands, turning the periphery
// into dedicated UI space (the gutter). Because the window is always a centered square
// of side min(W,H), the SAME geometry works in landscape (gutters left/right) AND
// portrait (gutters top/bottom) — which is what lets us run portrait without a separate
// layout. HUD anchors to the square rect + the gutter zones (see playWindowLayout), not
// the raw canvas edges, so it stays consistent across every aspect ratio.
//
// Pure geometry (no engine import) so it's unit-testable and reusable by every scene.

// The centered square play window for a W×H design viewport.
// `margin` insets the square from the smaller edge (so the frame isn't flush). Returns
// { x, y, size, cx, cy, right, bottom } in design units.
// Pure, but called many times per frame — every HUD/overlay draw re-derives the
// square. Memoize the hot margin=0 path on the last (W,H): a steady viewport makes
// all those calls one cheap cache hit. The cached rect is frozen — it's shared
// across callers, so freezing both documents the read-only contract and turns any
// accidental mutation into an immediate error instead of silent cross-caller
// corruption. Non-zero margins (rare, not per-frame) are computed fresh.
let _pwW = NaN, _pwH = NaN, _pwR = null;
export function playWindowRect(W, H, { margin = 0 } = {}) {
  if (margin === 0 && W === _pwW && H === _pwH) return _pwR;
  const size = Math.max(0, Math.min(W, H) - margin * 2);
  const x = Math.round((W - size) / 2);
  const y = Math.round((H - size) / 2);
  const r = { x, y, size, cx: x + size / 2, cy: y + size / 2, right: x + size, bottom: y + size };
  if (margin === 0) { _pwW = W; _pwH = H; _pwR = Object.freeze(r); }
  return r;
}

// The peripheral UI zones (gutters) around the square, in screen space. Only one pair
// has area for a given aspect — left/right in landscape, top/bottom in portrait; the
// other pair is zero-size. `landscape`/`portrait` flag which pair is usable so scenes
// can place HUD (minimap, team, controls) in the live gutter without re-deriving the
// math. Pure; re-evaluate per frame (resize-safe).
export function playWindowLayout(W, H, { margin = 0 } = {}) {
  const square = playWindowRect(W, H, { margin });
  const left = { x: 0, y: 0, w: square.x, h: H };
  const right = { x: square.right, y: 0, w: Math.max(0, W - square.right), h: H };
  const top = { x: 0, y: 0, w: W, h: square.y };
  const bottom = { x: 0, y: square.bottom, w: W, h: Math.max(0, H - square.bottom) };
  return {
    square, left, right, top, bottom,
    landscape: square.x > 0, // side gutters have width
    portrait: square.y > 0,  // top/bottom gutters have height
  };
}

// Occlude the peripheral map with fully OPAQUE bezel bands so the world is visible ONLY
// inside the centered square; the bands become UI space (the minimap / team / controls
// draw on top of them — see scenes). `bezel` is the gutter color (a touch darker than the
// app bg so the square reads as the "screen"). All bands are `fixed` (screen space).
// No-op-safe: a square viewport has zero-area gutters, so nothing is drawn.
//
// (Was a translucent dim that let the world bleed through; the user asked 2026-06-09 for
// the outside area to NOT show the world and to host the HUD/controls there.)
export function drawPlayWindow(k, { margin = 0, bezel = [10, 11, 16] } = {}) {
  const W = k.width(), H = k.height();
  const r = playWindowRect(W, H, { margin });
  const col = k.rgb(bezel[0], bezel[1], bezel[2]);
  const band = (x, y, w, h) => { if (w > 0 && h > 0) k.drawRect({ pos: k.vec2(x, y), width: w, height: h, color: col, opacity: 1, fixed: true }); };
  // Left/right gutters (have width only in landscape) …
  band(0, 0, r.x, H);
  band(r.right, 0, W - r.right, H);
  // … top/bottom gutters (have height only in portrait). Only one pair is non-empty.
  band(0, 0, W, r.y);
  band(0, r.bottom, W, H - r.bottom);
  return r;
}
