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

test("BUG-010: a collidable tile renders as void/boundary (abyss), not walkable floor", () => {
  // All floor except the centre (1,1) is collidable (e.g. water). The collidable
  // cell must read as the dark abyss the collision blocks — not as crossable floor.
  const map = makeMap(3, () => [90, 80, 60], (x, y) => x === 1 && y === 1);
  const { k, calls } = mockK();
  drawTiles(k, map, E * 1.5, E * 1.5, loadedCache(), E);

  const px = 1 * E, py = 1 * E;
  const abyssAtCell = calls.rect.some((o) => o.pos.x === px && o.pos.y === py && isColor(o, 11, 10, 16));
  assert.ok(abyssAtCell, "collidable cell drawn as abyss (void) — matches what collision blocks");
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
