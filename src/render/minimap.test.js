import { test } from "node:test";
import assert from "node:assert/strict";
import { minimapWindow, minimapSize } from "./minimap.js";

test("minimapSize: scales with the smaller dimension, clamped to [120,200]", () => {
  assert.equal(minimapSize(1280, 720), 200); // min=720 → 216 → upper clamp 200
  assert.equal(minimapSize(720, 720), 200);  // upper clamp
  assert.equal(minimapSize(600, 500), 150);  // min=500 → 150, in-band
  assert.equal(minimapSize(405, 720), 122);  // portrait: min=405 → round(121.5)=122, in-band
  assert.equal(minimapSize(300, 300), 120);  // min=300 → 90 → lower clamp 120
  // min(W,H) is symmetric → a landscape size equals its portrait transpose
  assert.equal(minimapSize(1280, 720), minimapSize(720, 1280));
});

// Box: 64-tile map, 160px minimap anchored at (1000, 500). baseScale = 160/64 = 2.5.
const MAP = 64, MM = 160, X = 1000, Y = 500;
const view = (o) => minimapWindow({ mapSize: MAP, mmSize: MM, mmX: X, mmY: Y, ...o });

test("zoom=1: whole map fills the box (ox=oy=0, scale=base), every cull passes", () => {
  const v = view({ zoom: 1, playerTileX: 10, playerTileY: 50 });
  assert.equal(v.scale, 2.5);
  assert.equal(v.win, MAP);
  assert.equal(v.ox, 0);
  assert.equal(v.oy, 0);
  // corners of the map map to corners of the box
  assert.deepEqual(v.project(0, 0), { x: X, y: Y });
  assert.deepEqual(v.project(MAP, MAP), { x: X + MM, y: Y + MM });
  // at 1× nothing is culled — even the last (parity-sensitive) cell, any step
  assert.equal(v.inWindow(0, 0), true);
  assert.equal(v.inWindow(MAP, MAP), true);
  assert.equal(v.cellVisible(MAP - 1, MAP - 1, 2), true);
});

test("zoom=2 centered: player sits at the box centre; window corners hit box corners", () => {
  const v = view({ zoom: 2, playerTileX: 32, playerTileY: 32 });
  assert.equal(v.scale, 5);
  assert.equal(v.win, 32);
  // origin clamped: 32 - 16 = 16, within [0, 64-32]
  assert.equal(v.ox, 16);
  assert.equal(v.oy, 16);
  assert.deepEqual(v.project(32, 32), { x: X + 80, y: Y + 80 }); // box centre
  assert.deepEqual(v.project(16, 16), { x: X, y: Y });           // window top-left → box top-left
  assert.deepEqual(v.project(48, 48), { x: X + MM, y: Y + MM }); // window bot-right → box bot-right
});

test("zoom>1: window origin clamps to map bounds (no out-of-bounds reveal at corners)", () => {
  // player in the top-left corner → origin can't go negative
  const tl = view({ zoom: 2, playerTileX: 0, playerTileY: 0 });
  assert.equal(tl.ox, 0);
  assert.equal(tl.oy, 0);
  // player in the bottom-right corner → origin pinned at mapSize - win
  const br = view({ zoom: 2, playerTileX: MAP, playerTileY: MAP });
  assert.equal(br.ox, MAP - 32);
  assert.equal(br.oy, MAP - 32);
});

test("zoom>1: inWindow culls blips outside the visible window", () => {
  const v = view({ zoom: 2, playerTileX: 32, playerTileY: 32 }); // window = [16, 48]
  assert.equal(v.inWindow(40, 40), true);   // inside
  assert.equal(v.inWindow(10, 30), false);  // left of window
  assert.equal(v.inWindow(50, 30), false);  // right of window
});

test("zoom>1: cellVisible tightens by one cell so a rect never spills the box edge", () => {
  const v = view({ zoom: 2, playerTileX: 32, playerTileY: 32 }); // window = [16, 48], step 2
  assert.equal(v.cellVisible(46, 46, 2), true);  // last cell that fits fully (<= 48-2)
  assert.equal(v.cellVisible(48, 48, 2), false); // right/bottom edge cell would overflow
  assert.equal(v.cellVisible(16, 16, 2), true);  // top-left in-window cell
  assert.equal(v.cellVisible(14, 14, 2), false); // outside window
});

test("zoom is clamped to >= 1 (0 / undefined / fractional never invert the transform)", () => {
  for (const z of [0, undefined, 0.5]) {
    const v = view({ zoom: z, playerTileX: 32, playerTileY: 32 });
    assert.equal(v.zoom, 1);
    assert.equal(v.scale, 2.5);
    assert.equal(v.ox, 0);
  }
});
