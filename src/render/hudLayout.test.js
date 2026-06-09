import { test } from "node:test";
import assert from "node:assert/strict";
import { hudLayout } from "./hudLayout.js";
import { playWindowLayout } from "./playWindow.js";

// The whole point of HUD-OUT: every cluster must sit in a GUTTER, never over the square.
test("hudLayout landscape: HUD clusters live in the left/right gutters, not over the square", () => {
  const W = 1280, H = 720;
  const L = hudLayout(W, H);
  const sq = playWindowLayout(W, H).square; // x=280, right=1000
  assert.equal(L.orientation, "landscape");
  // Left gutter: team / chain / objective / biome
  assert.ok(L.team.x < sq.x, "team in the left gutter");
  assert.ok(L.chain.x < sq.x, "chain in the left gutter");
  assert.ok(L.objective.x < sq.x, "objective centered in the left gutter");
  assert.ok(L.biome.x < sq.x, "biome in the left gutter");
  // Right gutter: timer + minimap
  assert.ok(L.timer.x > sq.right, "timer in the right gutter");
  assert.ok(L.minimap.x >= sq.right, "minimap starts at/after the square's right edge");
  assert.ok(L.minimap.x + L.minimap.size <= W, "minimap fits inside the right gutter");
  // pause sits at the top-right of the right gutter
  assert.ok(L.pause.x >= sq.right && L.pause.x + L.pause.w <= W, "pause in the right gutter");
});

test("hudLayout portrait: HUD clusters live in the top/bottom gutters, not over the square", () => {
  const W = 414, H = 896;
  const P = hudLayout(W, H);
  const sq = playWindowLayout(W, H).square; // y=241, bottom=655
  assert.equal(P.orientation, "portrait");
  // Top gutter: team / timer / minimap / objective
  assert.ok(P.team.y < sq.y, "team in the top gutter");
  assert.ok(P.timer.y < sq.y, "timer in the top gutter");
  assert.ok(P.minimap.y + P.minimap.size <= sq.y, "minimap fits within the top gutter");
  assert.ok(P.minimap.x + P.minimap.size <= W, "minimap fits within the screen width");
  // Bottom gutter: chain / biome / controls
  assert.ok(P.chain.y >= sq.bottom, "chain in the bottom gutter");
  assert.ok(P.biome.y >= sq.bottom && P.biome.y <= H, "biome in the bottom gutter");
  assert.ok(P.joystick.y >= sq.bottom, "joystick in the bottom gutter");
  assert.ok(P.throwBtn.y >= sq.bottom, "throw button in the bottom gutter");
});

test("hudLayout: safe-area insets push HUD inward (notch/home-bar aware)", () => {
  const base = hudLayout(414, 896);
  const inset = hudLayout(414, 896, { inset: { top: 30, bottom: 24, left: 10, right: 10 } });
  assert.ok(inset.team.x > base.team.x, "left inset pushes team right");
  assert.ok(inset.team.y > base.team.y, "top inset pushes team down");
  assert.ok(inset.minimap.x < base.minimap.x, "right inset pulls the minimap left");
});

test("hudLayout square aspect: falls back to the square edges (no gutters)", () => {
  const S = hudLayout(600, 600);
  assert.equal(S.orientation, "square");
  // everything keys off the square; minimap stays inside it
  assert.ok(S.minimap.x + S.minimap.size <= S.square.right);
  assert.ok(S.team.x >= S.square.x && S.team.y >= S.square.y);
});
