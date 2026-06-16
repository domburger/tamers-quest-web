import { test } from "node:test";
import assert from "node:assert";
import { drawTiles, makeTileCache, tileSpriteName } from "./tiles.js";

// drawTiles is node-testable: it only touches the engine via the k.* surface (no
// DOM) as long as tile sprites are pre-marked loaded so ensureTile() short-circuits
// before the canvas-based generateTileTexture(). We mock k to record draw calls.

const E = 80; // effective tile size

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

// N×N map. colorAt(x,y) → [r,g,b] for floor, null for a hole (void). collidableAt
// marks impassable tiles (e.g. water) — they carry a tile but must NOT be floor.
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
  // All floor except the centre (1,1) is collidable (e.g. water / a wall). The collidable cell must show
  // its AI texture (sprite) DIMMED so it reads as impassable — drawn at the EXACT cell (width E, not the
  // TQ-449 oversized floor draw) so it lines up with the hitbox — plus a black dim overlay. It must never
  // render as a crossable feathered FLOOR sprite (the invisible-wall guard the original BUG-010 protected).
  const map = makeMap(3, () => [90, 80, 60], (x, y) => x === 1 && y === 1);
  const { k, calls } = mockK();
  drawTiles(k, map, E * 1.5, E * 1.5, loadedCache(), E);

  const px = 1 * E, py = 1 * E, cx = px + E / 2, cy = py + E / 2;
  // The collidable cell's OWN texture, drawn at the EXACT cell size (E), centered — NOT the oversized
  // floor draw (E·TILE_DRAW_SCALE), so it matches the collision hitbox exactly.
  const texAtCell = calls.sprite.some((o) => o.pos.x === cx && o.pos.y === cy && o.sprite === tileSpriteName(1) && o.width === E);
  assert.ok(texAtCell, "collidable cell draws its darkened texture at the exact cell");
  const oversizedAtCell = calls.sprite.some((o) => o.pos.x === cx && o.pos.y === cy && o.width !== E);
  assert.ok(!oversizedAtCell, "collidable cell is NOT the oversized/feathered floor draw (stays on the hitbox)");
  // A black dim overlay over the cell so the texture reads ~0.4 as bright (impassable), not crossable floor.
  const dim = calls.rect.some((o) => o.pos.x === px && o.pos.y === py && o.width === E && o.height === E && isColor(o, 0, 0, 0) && o.opacity > 0);
  assert.ok(dim, "collidable cell gets a black dim overlay (reads as blocked)");
  const abyssAtCell = calls.rect.some((o) => o.pos.x === px && o.pos.y === py && isColor(o, 11, 10, 16));
  assert.ok(!abyssAtCell, "no black abyss within the grid (TQ-360: the void is now real tiles)");
  // TQ-466: no thin wall band (46,41,54) anywhere — walls were removed.
  assert.ok(!calls.rect.some((o) => isColor(o, 46, 41, 54)), "no wall bands drawn around the collidable cell");
});

test("collidable tile falls back to the flat dark shade until its texture rasterizes", () => {
  // Sprite NOT yet loaded (fresh cache) → the impassable cell still reads as blocked via the flat dark
  // shade (tile colour × 0.4), never as crossable floor, so there is no flash of walkable-looking ground.
  const map = makeMap(3, () => [90, 80, 60], (x, y) => x === 1 && y === 1);
  const { k, calls } = mockK();
  drawTiles(k, map, E * 1.5, E * 1.5, makeTileCache(), E); // unloaded cache

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

test("TQ-473: floor tile sprites draw at the EXACT cell (crisp seams — no TQ-449 overlap/cross-fade)", () => {
  const map = makeMap(3, () => [90, 80, 60]);
  const { k, calls } = mockK();
  drawTiles(k, map, E * 1.5, E * 1.5, loadedCache(), E);
  assert.ok(calls.sprite.length > 0, "floor tiles draw sprites");
  for (const o of calls.sprite) {
    assert.equal(o.width, E, "sprite is exactly one cell wide (no oversize/overlap)");
    assert.equal(o.height, E, "sprite is exactly one cell tall");
    // centered on the cell (anchor center at cell centre)
    assert.equal((o.pos.x - E / 2) % E, 0, "x centered on its cell");
    assert.equal((o.pos.y - E / 2) % E, 0, "y centered on its cell");
    assert.equal(o.anchor, "center", "centered anchor");
  }
});

test("TQ-466: walls removed — the off-map void is a flat abyss with no wall bands or corner fills", () => {
  // Floor fills the top-left 2×2; the rest is void. Previously (PT1-T12) the void cells bordering the
  // floor drew thin rock-wall bands + a convex-corner fill (colour 46,41,54). Walls are now removed:
  // the void is just the dark abyss (11,10,16) + motes, and the floor carries its own edge shadow.
  const map = makeMap(3, (x, y) => (x < 2 && y < 2 ? [90, 80, 60] : null));
  const { k, calls } = mockK();
  drawTiles(k, map, E * 1.5, E * 1.5, loadedCache(), E);
  assert.ok(!calls.rect.some((o) => isColor(o, 46, 41, 54)), "no wall bands / corner fills anywhere");
  assert.ok(calls.rect.some((o) => isColor(o, 11, 10, 16)), "void cells still draw the dark abyss");
});

test("PV-A3: patchwork overlay is skipped on uniform floor, drawn where colours differ", () => {
  // Uniform: every cell identical → neighbour-average == cell colour → the 0.22
  // overlay is a no-op → skipped (the perf optimisation).
  {
    const map = makeMap(3, () => [90, 80, 60]);
    const { k, calls } = mockK();
    drawTiles(k, map, E * 1.5, E * 1.5, loadedCache(), E);
    const patchwork = calls.rect.filter((o) => o.opacity === 0.22);
    assert.equal(patchwork.length, 0, "no patchwork overlays issued on uniform floor");
  }
  // Varied: one cell strongly differs from its neighbours → overlay IS drawn so the
  // softening still happens where it matters (no seam regression).
  {
    const map = makeMap(3, (x, y) => (x === 1 && y === 1 ? [200, 40, 40] : [90, 80, 60]));
    const { k, calls } = mockK();
    drawTiles(k, map, E * 1.5, E * 1.5, loadedCache(), E);
    const patchwork = calls.rect.filter((o) => o.opacity === 0.22);
    assert.ok(patchwork.length > 0, "patchwork overlay drawn where a cell differs from neighbours");
  }
});

test("ground scatter is memoized per cell and replays byte-identically each frame", () => {
  // Scatter geometry is deterministic + map-static, so it's computed once into
  // cache.scatter and merely replayed — the second frame must draw exactly the same
  // ellipses as the first (proves the memoized replay matches the original output).
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
  // A map with both floor and void (the outer ring is a hole) exercises drawVoidCell's
  // mote path. Motes are deterministic + map-static, so the in-grid void cells are
  // memoized and the second frame must draw exactly the same ellipses as the first.
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
  // First draw populates the per-cell average cache (one entry per visible floor cell).
  const a = mockK();
  drawTiles(a.k, map, E * 1.5, E * 1.5, cache, E);
  assert.ok(cache.avg && cache.avg.size > 0, "neighbourAvg results memoized after first draw");
  const pw1 = a.calls.rect.filter((o) => o.opacity === 0.22).length;
  // Second draw must reuse the cache and produce an identical patchwork result.
  const b = mockK();
  drawTiles(b.k, map, E * 1.5, E * 1.5, cache, E);
  const pw2 = b.calls.rect.filter((o) => o.opacity === 0.22).length;
  assert.equal(pw2, pw1, "memoized second frame draws the same patchwork overlays (output-stable)");
});
