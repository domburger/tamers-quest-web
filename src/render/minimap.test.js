import { test } from "node:test";
import assert from "node:assert/strict";
import { minimapWindow, minimapSize, nextMinimapZoom, MINIMAP_ZOOM_LEVELS } from "./minimap.js";

test("nextMinimapZoom: cycles 1 → 2 → 4 → 1 (lets the radar zoom in closer, wraps)", () => {
  assert.deepEqual(MINIMAP_ZOOM_LEVELS, [1, 2, 4]);
  assert.equal(nextMinimapZoom(1), 2);
  assert.equal(nextMinimapZoom(2), 4);
  assert.equal(nextMinimapZoom(4), 1);
  assert.equal(nextMinimapZoom(3), 1);
  assert.equal(nextMinimapZoom(undefined), 1);
});

test("minimapSize: scales with the smaller dimension, clamped to [120,200]", () => {
  assert.equal(minimapSize(1280, 720), 200);
  assert.equal(minimapSize(720, 720), 200);
  assert.equal(minimapSize(600, 500), 150);
  assert.equal(minimapSize(405, 720), 122);
  assert.equal(minimapSize(300, 300), 120);
  assert.equal(minimapSize(1280, 720), minimapSize(720, 1280));
});

const MAP = 64, MM = 160, X = 1000, Y = 500;
const view = (o) => minimapWindow({ mapSize: MAP, mmSize: MM, mmX: X, mmY: Y, ...o });

test("zoom=1: whole map fills the box (ox=oy=0, scale=base), every cull passes", () => {
  const v = view({ zoom: 1, playerTileX: 10, playerTileY: 50 });
  assert.equal(v.scale, 2.5);
  assert.equal(v.win, MAP);
  assert.equal(v.ox, 0);
  assert.equal(v.oy, 0);
  assert.deepEqual(v.project(0, 0), { x: X, y: Y });
  assert.deepEqual(v.project(MAP, MAP), { x: X + MM, y: Y + MM });
  assert.equal(v.inWindow(0, 0), true);
  assert.equal(v.inWindow(MAP, MAP), true);
  assert.equal(v.cellVisible(MAP - 1, MAP - 1, 2), true);
});

test("zoom=2 centered: player sits at the box centre; window corners hit box corners", () => {
  const v = view({ zoom: 2, playerTileX: 32, playerTileY: 32 });
  assert.equal(v.scale, 5);
  assert.equal(v.win, 32);
  assert.equal(v.ox, 16);
  assert.equal(v.oy, 16);
  assert.deepEqual(v.project(32, 32), { x: X + 80, y: Y + 80 });
  assert.deepEqual(v.project(16, 16), { x: X, y: Y });
  assert.deepEqual(v.project(48, 48), { x: X + MM, y: Y + MM });
});

test("zoom>1: window origin clamps to map bounds (no out-of-bounds reveal at corners)", () => {
  const tl = view({ zoom: 2, playerTileX: 0, playerTileY: 0 });
  assert.equal(tl.ox, 0);
  assert.equal(tl.oy, 0);
  const br = view({ zoom: 2, playerTileX: MAP, playerTileY: MAP });
  assert.equal(br.ox, MAP - 32);
  assert.equal(br.oy, MAP - 32);
});

test("zoom>1: inWindow culls blips outside the visible window", () => {
  const v = view({ zoom: 2, playerTileX: 32, playerTileY: 32 });
  assert.equal(v.inWindow(40, 40), true);
  assert.equal(v.inWindow(10, 30), false);
  assert.equal(v.inWindow(50, 30), false);
});

test("zoom>1: cellVisible tightens by one cell so a rect never spills the box edge", () => {
  const v = view({ zoom: 2, playerTileX: 32, playerTileY: 32 });
  assert.equal(v.cellVisible(46, 46, 2), true);
  assert.equal(v.cellVisible(48, 48, 2), false);
  assert.equal(v.cellVisible(16, 16, 2), true);
  assert.equal(v.cellVisible(14, 14, 2), false);
});

test("zoom is clamped to >= 1 (0 / undefined / fractional never invert the transform)", () => {
  for (const z of [0, undefined, 0.5]) {
    const v = view({ zoom: z, playerTileX: 32, playerTileY: 32 });
    assert.equal(v.zoom, 1);
    assert.equal(v.scale, 2.5);
    assert.equal(v.ox, 0);
  }
});
