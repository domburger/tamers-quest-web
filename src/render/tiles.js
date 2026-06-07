// Floor-tile detail (user request 2026-06-06). The map view used to draw each
// tile as one flat rect of its `colorProfile_full`, throwing away the per-side
// edge colors AND the rotation the tile data carries — so floors looked
// featureless. This restores depth: a procedurally-textured sprite per tile
// *type* (grain + directional light + the top/bottom/left/right edge shades),
// drawn at the tile's rotation. Generated once per type and cached, so the draw
// cost stays one sprite per tile (same as the old flat rect). A flat-color rect
// is drawn as a fallback for the frame or two before a type's sprite finishes
// loading. Self-contained (no engine/scene imports) to limit merge conflicts.

const TEX = 64; // generated texture resolution (scaled to the tile's screen size)

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const shade = (c, d) => [clamp255(c[0] + d), clamp255(c[1] + d), clamp255(c[2] + d)];
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// Small deterministic PRNG so each tile type gets a stable grain pattern.
function mulberry32(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const full = (t) => [t.colorProfile_full_r, t.colorProfile_full_g, t.colorProfile_full_b];
const side = (t, k) => [t[`colorProfile_${k}_r`], t[`colorProfile_${k}_g`], t[`colorProfile_${k}_b`]];
export const tileSpriteName = (id) => `tile_${id}`;

// Build a detailed floor texture for one tile type. Returns a <canvas> (what
// Kaboom's loadSprite accepts, matching the monster sprite generator).
export function generateTileTexture(tile, S = TEX) {
  const c = makeCanvas(S, S);
  const ctx = c.getContext("2d");
  const base = full(tile);
  const rnd = mulberry32((tile.id || 1) * 2654435761);

  // Base fill.
  ctx.fillStyle = rgba(base, 1);
  ctx.fillRect(0, 0, S, S);

  // Per-side edge color as a *faint* inward gradient. Kept subtle on purpose:
  // strong edges framed every tile as a square and — worse — drew a false seam
  // between identical same-type neighbours, reading as a hard grid (the opposite
  // of the "natural top-down" goal). The grain + per-cell scatter carry the
  // detail now; these edges only gently hint the tile's own side hues.
  const band = Math.max(3, Math.round(S * 0.20));
  const edge = (key, x, y, w, h, gx0, gy0, gx1, gy1) => {
    const ec = side(tile, key);
    const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    g.addColorStop(0, rgba(ec, 0.14));
    g.addColorStop(1, rgba(ec, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  };
  edge("top", 0, 0, S, band, 0, 0, 0, band);
  edge("bottom", 0, S - band, S, band, 0, S, 0, S - band);
  edge("left", 0, 0, band, S, 0, 0, band, 0);
  edge("right", S - band, 0, band, S, S, 0, S - band, 0);

  // Grain: scattered ±brightness specks break up the flat fill (deterministic).
  // FINE only — kept high-frequency so the per-type texture, reused on every tile
  // of that type, never reads as a repeating macro-pattern; fine noise just gives
  // the ground a richer mineral texture instead of a flat wash. (Directional light
  // was removed earlier — it created visible grid seams between neighbours.)
  const specks = Math.round(S * S * 0.16);
  for (let i = 0; i < specks; i++) {
    const x = (rnd() * S) | 0, y = (rnd() * S) | 0;
    const d = (rnd() - 0.5) * 42;
    const sz = rnd() < 0.10 ? 2 : 1;
    ctx.fillStyle = rgba(shade(base, d), 0.30);
    ctx.fillRect(x, y, sz, sz);
  }
  // A faint sparse fleck of brighter mineral glints, so the floor catches a little
  // of the cave's bioluminescent light (very low density → not a visible pattern).
  const glints = Math.round(S * S * 0.012);
  for (let i = 0; i < glints; i++) {
    const x = (rnd() * S) | 0, y = (rnd() * S) | 0;
    ctx.fillStyle = rgba(shade(base, 60), 0.22);
    ctx.fillRect(x, y, 1, 1);
  }

  return c;
}

// Per-scene cache of which tile-type sprites are loaded / in flight.
export function makeTileCache() {
  return { loaded: new Set(), pending: new Set() };
}

// Ensure a tile type's sprite is being generated+loaded; safe to call every frame.
function ensureTile(k, tile, cache) {
  const id = tile.id;
  if (id == null || cache.loaded.has(id) || cache.pending.has(id)) return;
  cache.pending.add(id);
  try {
    const res = k.loadSprite(tileSpriteName(id), generateTileTexture(tile));
    Promise.resolve(res)
      .then(() => { cache.loaded.add(id); cache.pending.delete(id); })
      .catch(() => { cache.pending.delete(id); });
  } catch {
    cache.pending.delete(id);
  }
}

// Sparse, deterministic ground scatter (pebbles/flecks) over a cell — breaks the
// uniform tile grid for a more natural top-down floor. Seeded per cell → stable +
// non-repeating (unlike the per-type tile texture). Cheap: ~30% of visible cells.
function drawScatter(k, t, x, y, E) {
  const rnd = mulberry32((x * 73856093) ^ (y * 19349663));
  if (rnd() > 0.3) return;
  const base = [t.colorProfile_full_r || 60, t.colorProfile_full_g || 60, t.colorProfile_full_b || 60];
  const n = rnd() < 0.25 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const px = x * E + 4 + rnd() * (E - 8);
    const py = y * E + 4 + rnd() * (E - 8);
    const c = shade(base, rnd() < 0.5 ? -30 : 24); // pebble (darker) or fleck (lighter)
    k.drawEllipse({ pos: k.vec2(px, py), radiusX: 2 + rnd() * 1.5, radiusY: 1.4 + rnd(), color: k.rgb(c[0], c[1], c[2]), opacity: 0.5 });
  }
}

// Local-average colour of a cell (self + its 4 orthogonal neighbours). Used to
// soften the per-tile colour *patchwork*: nudging each cell toward this average
// reduces how much a tile stands out from its neighbours, so the floor reads as
// continuous ground rather than a hard grid. Self-correcting — inside a uniform
// region the average ≈ the cell's own colour, so the nudge is a visual no-op;
// only tiles that differ from their surroundings get pulled in. Void/null cells
// are excluded so edge tiles aren't dragged toward black.
function neighborAvg(map, x, y) {
  const at = (xx, yy) => {
    const c = map.tileMap[xx];
    const t = c && c[yy];
    return t ? [t.colorProfile_full_r, t.colorProfile_full_g, t.colorProfile_full_b] : null;
  };
  const cells = [at(x, y), at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].filter(Boolean);
  if (!cells.length) return null;
  let r = 0, g = 0, b = 0;
  for (const c of cells) { r += c[0]; g += c[1]; b += c[2]; }
  const n = cells.length;
  return [r / n, g / n, b / n];
}

// A cell is floor (walkable) iff it's in-grid and has a tile; everything else —
// null cells and anything beyond the grid — is void.
// "Floor" = a walkable tile. Must match the collision's walkability (voidMap +
// !collidable) so impassable tiles (e.g. water, collidable:1) render as a
// boundary, not as walkable floor — otherwise they look like floor you can't
// cross ("invisible wall", user-reported 2026-06-07).
const isFloor = (map, x, y) =>
  x >= 0 && x < map.mapSize && y >= 0 && y < map.mapSize &&
  map.tileMap[x] && map.tileMap[x][y] != null && !map.tileMap[x][y].collidable;

// Void rendering (user-tuned 2026-06-06): the off-map area is a dark **abyss**;
// where it borders the floor we draw a *thin* rock wall hugging the inside of the
// void edge — just around the black — rather than filling whole cells. Paired with
// the floor-edge shadow below, a boundary reads: floor → shadow → thin wall → abyss.
const WALL_T = (E) => Math.max(3, E * 0.13); // thin wall band width
function drawVoidCell(k, map, x, y, E) {
  const px = x * E, py = y * E;
  k.drawRect({ pos: k.vec2(px, py), width: E, height: E, color: k.rgb(11, 10, 16) }); // abyss
  // PT1-T11: faint deterministic motes so the abyss reads as cave depth, not flat
  // black (playtest: "void needs texture"). Seeded per cell → stable + non-repeating.
  const vr = mulberry32((x * 374761393) ^ (y * 668265263));
  if (vr() < 0.4) {
    const m = vr() < 0.3 ? 2 : 1;
    for (let i = 0; i < m; i++) {
      const mx = px + 3 + vr() * (E - 6), my = py + 3 + vr() * (E - 6), g = 22 + Math.floor(vr() * 14), r = 0.8 + vr() * 1.1;
      k.drawEllipse({ pos: k.vec2(mx, my), radiusX: r, radiusY: r, color: k.rgb(g - 4, g - 6, g + 5), opacity: 0.5 }); // drawEllipse (matches drawScatter; drawCircle not in the tiles test mock)
    }
  }
  const T = WALL_T(E), wall = k.rgb(46, 41, 54);
  // Thin wall only on the edge(s) of this void cell that touch the floor.
  const up = isFloor(map, x, y - 1), dn = isFloor(map, x, y + 1);
  const lf = isFloor(map, x - 1, y), rt = isFloor(map, x + 1, y);
  if (up) k.drawRect({ pos: k.vec2(px, py), width: E, height: T, color: wall });
  if (dn) k.drawRect({ pos: k.vec2(px, py + E - T), width: E, height: T, color: wall });
  if (lf) k.drawRect({ pos: k.vec2(px, py), width: T, height: E, color: wall });
  if (rt) k.drawRect({ pos: k.vec2(px + E - T, py), width: T, height: E, color: wall });
  // PT1-T12: close convex floor corners. Where a *diagonal* neighbour is floor but
  // neither orthogonal toward it is, the two adjacent void cells' edge walls form an
  // open "L" with a T×T abyss gap at this cell's corner — fill it so the wall reads
  // as continuous all the way around (mirrors the concave-corner shadow below).
  if (!up && !lf && isFloor(map, x - 1, y - 1)) k.drawRect({ pos: k.vec2(px, py), width: T, height: T, color: wall });
  if (!up && !rt && isFloor(map, x + 1, y - 1)) k.drawRect({ pos: k.vec2(px + E - T, py), width: T, height: T, color: wall });
  if (!dn && !lf && isFloor(map, x - 1, y + 1)) k.drawRect({ pos: k.vec2(px, py + E - T), width: T, height: T, color: wall });
  if (!dn && !rt && isFloor(map, x + 1, y + 1)) k.drawRect({ pos: k.vec2(px + E - T, py + E - T), width: T, height: T, color: wall });
}

// Inner shadow where the floor meets the void → the floor reads as recessed below
// the surrounding walls. Corner-aware: the left/right bands skip the corners the
// top/bottom bands already cover (so convex floor corners aren't double-darkened),
// and concave corners — where only the *diagonal* neighbour is void — get a small
// matching shadow so the outline stays consistent all the way around.
function drawFloorEdgeShadow(k, map, x, y, E) {
  const px = x * E, py = y * E, t = Math.max(3, E * 0.16), col = k.rgb(0, 0, 0), op = 0.34;
  const up = !isFloor(map, x, y - 1), dn = !isFloor(map, x, y + 1);
  const lf = !isFloor(map, x - 1, y), rt = !isFloor(map, x + 1, y);
  if (up) k.drawRect({ pos: k.vec2(px, py), width: E, height: t, color: col, opacity: op });
  if (dn) k.drawRect({ pos: k.vec2(px, py + E - t), width: E, height: t, color: col, opacity: op });
  const iy = py + (up ? t : 0), ih = E - (up ? t : 0) - (dn ? t : 0); // skip corners owned by top/bottom
  if (lf) k.drawRect({ pos: k.vec2(px, iy), width: t, height: ih, color: col, opacity: op });
  if (rt) k.drawRect({ pos: k.vec2(px + E - t, iy), width: t, height: ih, color: col, opacity: op });
  // Concave corners: orthogonals are floor but the diagonal is void → shadow it.
  const corner = (cx, cy) => k.drawRect({ pos: k.vec2(cx, cy), width: t, height: t, color: col, opacity: op });
  if (!up && !rt && !isFloor(map, x + 1, y - 1)) corner(px + E - t, py);
  if (!up && !lf && !isFloor(map, x - 1, y - 1)) corner(px, py);
  if (!dn && !rt && !isFloor(map, x + 1, y + 1)) corner(px + E - t, py + E - t);
  if (!dn && !lf && !isFloor(map, x - 1, y + 1)) corner(px, py + E - t);
}

// Draw the culled, camera-centered floor + the enclosing void. Textured sprite
// per tile (at its rotation) once loaded; flat-color rect until then. `E` = GAME.EFFECTIVE_TILE.
export function drawTiles(k, map, camX, camY, cache, E) {
  if (!map) return;
  const halfW = k.width() / 2, halfH = k.height() / 2;
  // View range is NOT clamped to the grid, so the void/abyss fills the screen
  // right up to (and past) the map edge — flat background never shows.
  const x0 = Math.floor((camX - halfW) / E) - 1;
  const x1 = Math.ceil((camX + halfW) / E) + 1;
  const y0 = Math.floor((camY - halfH) / E) - 1;
  const y1 = Math.ceil((camY + halfH) / E) + 1;
  for (let x = x0; x <= x1; x++) {
    const col = (x >= 0 && x < map.mapSize) ? map.tileMap[x] : null;
    for (let y = y0; y <= y1; y++) {
      const t = (col && y >= 0 && y < map.mapSize) ? col[y] : null;
      if (!t || t.collidable) {
        // void OR an impassable tile (e.g. water): render as a boundary, not floor,
        // so collision (which blocks these) matches what the player sees. (@phaser:
        // refine the water look later; this removes the invisible-wall, user 06-07.)
        drawVoidCell(k, map, x, y, E); // abyss + thin wall hugging any floor edge
        continue;
      }
      ensureTile(k, t, cache);
      if (t.id != null && cache.loaded.has(t.id)) {
        k.drawSprite({
          sprite: tileSpriteName(t.id),
          pos: k.vec2(x * E + E / 2, y * E + E / 2),
          anchor: "center",
          angle: t.rotation || 0,
          width: E, height: E, // exact cell — no overlap with neighbours
        });
      } else {
        k.drawRect({
          pos: k.vec2(x * E, y * E), width: E, height: E,
          color: k.rgb(t.colorProfile_full_r, t.colorProfile_full_g, t.colorProfile_full_b),
        });
      }
      // Patchwork softener: nudge the cell toward its local average so adjacent
      // tiles blend into ground instead of a grid (no-op in uniform regions).
      // Perf (PV-A3): the overlay is a *visual no-op* where the cell already ≈ its
      // neighbour average (most of a biome) — at 0.22 opacity a ≤2/channel gap shifts
      // the pixel <0.5/255, below display precision — so skip the draw there. This
      // is output-preserving and drops most overlay draw-calls on uniform floor.
      const avg = neighborAvg(map, x, y);
      if (avg && (Math.abs(avg[0] - t.colorProfile_full_r) > 2 || Math.abs(avg[1] - t.colorProfile_full_g) > 2 || Math.abs(avg[2] - t.colorProfile_full_b) > 2))
        k.drawRect({ pos: k.vec2(x * E, y * E), width: E, height: E, color: k.rgb(avg[0], avg[1], avg[2]), opacity: 0.22 });
      drawScatter(k, t, x, y, E); // P-natural: sparse ground detail over the tile
      drawFloorEdgeShadow(k, map, x, y, E); // enclosed-space depth at the wall base
    }
  }
  // Mood wash: alpha-blend the whole terrain toward the near-black violet base so the
  // cave matches the "bioluminescent dark" theme of the menus/title (the raw biome
  // tiles read too bright/washed). Drawn over floor+void but UNDER entities (player,
  // chests, portals, atmosphere are all drawn after drawTiles), so terrain darkens
  // while the player's teal rim and glowing pickups pop. Relative biome variety is
  // preserved (uniform alpha blend). Tunable via FLOOR_MOOD.
  k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(),
    color: k.rgb(FLOOR_MOOD.r, FLOOR_MOOD.g, FLOOR_MOOD.b), opacity: FLOOR_MOOD.a, fixed: true });
}

// Terrain mood wash (near-black violet, ~33% over the floor). Bumps the bright raw
// biome tiles into the dark theme. Lower `a` for a brighter cave, raise for darker.
const FLOOR_MOOD = { r: 9, g: 8, b: 16, a: 0.34 };
