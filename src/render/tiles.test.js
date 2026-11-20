import { test } from "node:test";
import assert from "node:assert";
import { drawTiles, makeTileCache, tileSpriteName } from "./tiles.js";

const E = 80;

function mockK() {
  const calls = { rect: [], sprite: [], ellipse: [] };
  const k = {
    width: () => 200,
    height: () => 200,
    vec2: (x, y) => ({ x, y }),
    rgb: (r, g, b) => ({ r, g, b }),
    drawRect: (o) => calls.rect.push(o),
    drawSprite: (o) => calls.sprite.push(o),
    drawEllipse: (o) => calls.ellipse.push(o),
    loadSprite: () => Promise.resolve(),
  };
  return { k, calls };
}

function makeMap(N, colorAt, collidableAt = () => false) {
  const tileMap = [];
  for (let x = 0; x < N; x++) {
    tileMap[x] = [];
    for (let y = 0; y < N; y++) {
      const c = colorAt(x, y);
      tileMap[x][y] = c
        ? { id: 1, rotation: 0, collidable: collidableAt(x, y),
            colorProfile_full_r: c[0], colorProfile_full_g: c[1], colorProfile_full_b: c[2] }
        : null;
    }
  }
  return { mapSize: N, tileMap };
}

const isColor = (o, r, g, b) => o.color && o.color.r === r && o.color.g === g && o.color.b === b;
const loadedCache = () => { const c = makeTileCache(); c.loaded.add(1); return c; };

test("collidable in-grid tile renders its OWN texture DARKENED at the exact cell (no floor feather, no abyss, no walls)", () => {
  const map = makeMap(3, () => [90, 80, 60], (x, y) => x === 1 && y === 1);
  const { k, calls } = mockK();
  drawTiles(k, map, E * 1.5, E * 1.5, loadedCache(), E);

  const px = 1 * E, py = 1 * E, cx = px + E / 2, cy = py + E / 2;
  const texAtCell = calls.sprite.some((o) => o.pos.x === cx && o.pos.y === cy && o.sprite === tileSpriteName(1) && o.width === E);
  assert.ok(texAtCell, "collidable cell draws its darkened texture at the exact cell");
  const oversizedAtCell = calls.sprite.some((o) => o.pos.x === cx && o.pos.y === cy && o.width !== E);
  assert.ok(!oversizedAtCell, "collidable cell is NOT the oversized/feathered floor draw (stays on the hitbox)");
  const dim = calls.rect.some((o) => o.pos.x === px && o.pos.y === py && o.width === E && o.height === E && isColor(o, 0, 0, 0) && o.opacity > 0);
  assert.ok(dim, "collidable cell gets a black dim overlay (reads as blocked)");
  const abyssAtCell = calls.rect.some((o) => o.pos.x === px && o.pos.y === py && isColor(o, 11, 10, 16));
  assert.ok(!abyssAtCell, "no black abyss within the grid (TQ-360: the void is now real tiles)");
  assert.ok(!calls.rect.some((o) => isColor(o, 46, 41, 54)), "no wall bands drawn around the collidable cell");
});

test("collidable tile falls back to the flat dark shade until its texture rasterizes", () => {
  const map = makeMap(3, () => [90, 80, 60], (x, y) => x === 1 && y === 1);
  const { k, calls } = mockK();
  drawTiles(k, map, E * 1.5, E * 1.5, makeTileCache(), E);

  const px = 1 * E, py = 1 * E;
  const shade = calls.rect.some((o) => o.pos.x === px && o.pos.y === py && o.width === E && o.height === E && isColor(o, 36, 32, 24));
  assert.ok(shade, "collidable cell falls back to the full-cell dark shade (90,80,60 × 0.4 → 36,32,24)");
  const texAtCell = calls.sprite.some((o) => o.pos.x === px + E / 2 && o.pos.y === py + E / 2);
  assert.ok(!texAtCell, "no sprite drawn at the collidable cell while its texture is unloaded");
});

test("walkable floor renders as the cached tile sprite", () => {
  const map = makeMap(3, () => [90, 80, 60]);
  const { k, calls } = mockK();
  drawTiles(k, map, E * 1.5, E * 1.5, loadedCache(), E);
  assert.ok(calls.sprite.length > 0, "floor tiles draw sprites");
  assert.ok(calls.sprite.every((o) => o.sprite === tileSpriteName(1)), "uses the per-type tile sprite");
});

test("TQ-449: floor tile sprites are drawn oversized + centered so they overlap + cross-fade into neighbours", () => {
  const map = makeMap(3, () => [90, 80, 60]);
  const { k, calls } = mockK();
  drawTiles(k, map, E * 1.5, E * 1.5, loadedCache(), E);
  assert.ok(calls.sprite.length > 0, "floor tiles draw sprites");
  for (const o of calls.sprite) {
    assert.ok(o.width > E, "sprite oversized beyond the cell (overlap)");
    assert.equal(o.width, o.height, "square draw");
    assert.equal((o.pos.x - E / 2) % E, 0, "x centered on its cell");
    assert.equal((o.pos.y - E / 2) % E, 0, "y centered on its cell");
    assert.equal(o.anchor, "center", "centered anchor");
  }
});

test("TQ-466: walls removed — the off-map void is a flat abyss with no wall bands or corner fills", () => {
  const map = makeMap(3, (x, y) => (x < 2 && y < 2 ? [90, 80, 60] : null));
  const { k, calls } = mockK();
  drawTiles(k, map, E * 1.5, E * 1.5, loadedCache(), E);
  assert.ok(!calls.rect.some((o) => isColor(o, 46, 41, 54)), "no wall bands / corner fills anywhere");
  assert.ok(calls.rect.some((o) => isColor(o, 11, 10, 16)), "void cells still draw the dark abyss");
});

test("PV-A3: patchwork overlay is skipped on uniform floor, drawn where colours differ", () => {
  {
    const map = makeMap(3, () => [90, 80, 60]);
    const { k, calls } = mockK();
    drawTiles(k, map, E * 1.5, E * 1.5, loadedCache(), E);
    const patchwork = calls.rect.filter((o) => o.opacity === 0.22);
    assert.equal(patchwork.length, 0, "no patchwork overlays issued on uniform floor");
  }
  {
    const map = makeMap(3, (x, y) => (x === 1 && y === 1 ? [200, 40, 40] : [90, 80, 60]));
    const { k, calls } = mockK();
    drawTiles(k, map, E * 1.5, E * 1.5, loadedCache(), E);
    const patchwork = calls.rect.filter((o) => o.opacity === 0.22);
    assert.ok(patchwork.length > 0, "patchwork overlay drawn where a cell differs from neighbours");
  }
});

test("ground scatter is memoized per cell and replays byte-identically each frame", () => {
  const map = makeMap(3, () => [90, 80, 60]);
  const cache = loadedCache();
  const a = mockK();
  drawTiles(a.k, map, E * 1.5, E * 1.5, cache, E);
  assert.ok(cache.scatter && cache.scatter.size > 0, "scatter geometry memoized after first draw");
  const b = mockK();
  drawTiles(b.k, map, E * 1.5, E * 1.5, cache, E);
  assert.equal(b.calls.ellipse.length, a.calls.ellipse.length, "same number of scatter/mote ellipses each frame");
  for (let i = 0; i < a.calls.ellipse.length; i++) {
    const e1 = a.calls.ellipse[i], e2 = b.calls.ellipse[i];
    assert.deepEqual(
      { x: e2.pos.x, y: e2.pos.y, rx: e2.radiusX, ry: e2.radiusY, c: e2.color, op: e2.opacity },
      { x: e1.pos.x, y: e1.pos.y, rx: e1.radiusX, ry: e1.radiusY, c: e1.color, op: e1.opacity },
      "memoized scatter replays the identical ellipse",
    );
  }
});

test("void abyss motes are memoized per cell and replay byte-identically each frame", () => {
  const map = makeMap(5, (x, y) => (x === 0 || y === 0 || x === 4 || y === 4 ? null : [90, 80, 60]));
  const cache = loadedCache();
  const a = mockK();
  drawTiles(a.k, map, E * 2, E * 2, cache, E);
  assert.ok(cache.voidMote && cache.voidMote.size > 0, "void-mote geometry memoized after first draw");
  const b = mockK();
  drawTiles(b.k, map, E * 2, E * 2, cache, E);
  assert.equal(b.calls.ellipse.length, a.calls.ellipse.length, "same number of ellipses each frame");
  for (let i = 0; i < a.calls.ellipse.length; i++) {
    const e1 = a.calls.ellipse[i], e2 = b.calls.ellipse[i];
    assert.deepEqual(
      { x: e2.pos.x, y: e2.pos.y, rx: e2.radiusX, ry: e2.radiusY, c: e2.color, op: e2.opacity },
      { x: e1.pos.x, y: e1.pos.y, rx: e1.radiusX, ry: e1.radiusY, c: e1.color, op: e1.opacity },
      "memoized void mote replays the identical ellipse",
    );
  }
});

test("PV-A3: neighbourAvg is memoized in the cache and output is frame-stable", () => {
  const map = makeMap(3, (x, y) => (x === 1 && y === 1 ? [200, 40, 40] : [90, 80, 60]));
  const cache = loadedCache();
  const a = mockK();
  drawTiles(a.k, map, E * 1.5, E * 1.5, cache, E);
  assert.ok(cache.avg && cache.avg.size > 0, "neighbourAvg results memoized after first draw");
  const pw1 = a.calls.rect.filter((o) => o.opacity === 0.22).length;
  const b = mockK();
  drawTiles(b.k, map, E * 1.5, E * 1.5, cache, E);
  const pw2 = b.calls.rect.filter((o) => o.opacity === 0.22).length;
  assert.equal(pw2, pw1, "memoized second frame draws the same patchwork overlays (output-stable)");
});
