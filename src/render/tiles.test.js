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

test("BUG-010 / TQ-360: a collidable in-grid tile renders as a recessed boundary (its darkened tile), not floor or abyss", () => {
  // All floor except the centre (1,1) is collidable (e.g. water). TQ-360: the collidable cell must read
  // as an impassable boundary drawn from its OWN tile darkened (no black abyss inside the grid), and
  // must NEVER render as crossable floor (the invisible-wall guard the original BUG-010 protected).
  const map = makeMap(3, () => [90, 80, 60], (x, y) => x === 1 && y === 1);
  const { k, calls } = mockK();
  drawTiles(k, map, E * 1.5, E * 1.5, loadedCache(), E);

  const px = 1 * E, py = 1 * E;
  // The tile's full colour darkened to ~half (90,80,60 → 45,40,30) — the recessed-boundary fill.
  const boundaryFill = calls.rect.some((o) => o.pos.x === px && o.pos.y === py && isColor(o, 45, 40, 30));
  assert.ok(boundaryFill, "collidable cell drawn as its darkened tile (recessed impassable boundary)");
  const abyssAtCell = calls.rect.some((o) => o.pos.x === px && o.pos.y === py && isColor(o, 11, 10, 16));
  assert.ok(!abyssAtCell, "no black abyss within the grid (TQ-360: the void is now real tiles)");
  const spriteAtCell = calls.sprite.some((o) => o.pos.x === px + E / 2 && o.pos.y === py + E / 2);
  assert.ok(!spriteAtCell, "collidable cell is NOT drawn as a floor sprite (no invisible wall)");
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
    // still centered on the cell so the opaque core stays aligned (anchor center at cell centre)
    assert.equal((o.pos.x - E / 2) % E, 0, "x centered on its cell");
    assert.equal((o.pos.y - E / 2) % E, 0, "y centered on its cell");
    assert.equal(o.anchor, "center", "centered anchor");
  }
});

test("PT1-T12: wall corner closed at a convex floor corner (no abyss gap)", () => {
  // Floor fills the top-left 2×2; the rest is void. Floor cell (1,1) is a convex
  // corner, so the diagonal void cell (2,2) — orthogonally all-void but with floor
  // up-left — must get a T×T wall piece at its top-left corner to close the "L"
  // the two adjacent edge walls would otherwise leave open (abyss showing through).
  const map = makeMap(3, (x, y) => (x < 2 && y < 2 ? [90, 80, 60] : null));
  const { k, calls } = mockK();
  drawTiles(k, map, E * 1.5, E * 1.5, loadedCache(), E);
  const T = Math.max(3, E * 0.13);
  const corner = calls.rect.find((o) =>
    o.pos.x === 2 * E && o.pos.y === 2 * E && isColor(o, 46, 41, 54) &&
    Math.abs(o.width - T) < 1e-6 && Math.abs(o.height - T) < 1e-6);
  assert.ok(corner, "convex-corner wall piece fills the diagonal void cell's corner");
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
