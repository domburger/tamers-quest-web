// Floor-tile detail (user request 2026-06-06). The map view used to draw each
// tile as one flat rect of its `colorProfile_full`, throwing away the per-side
// edge colors AND the rotation the tile data carries — so floors looked
// featureless. This restores depth: a procedurally-textured sprite per tile
// *type* (grain + directional light + the top/bottom/left/right edge shades),
// drawn at the tile's rotation. Generated once per type and cached, so the draw
// cost stays one sprite per tile (same as the old flat rect). A flat-color rect
// is drawn as a fallback for the frame or two before a type's sprite finishes
// loading. Self-contained (no engine/scene imports) to limit merge conflicts.

const TEX = 48; // generated texture resolution (scaled to the tile's screen size)

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

  // Per-side edge shading using the tile's own edge colors — a soft inward
  // gradient on each side, so adjacent tiles read as distinct surfaces.
  const band = Math.max(3, Math.round(S * 0.22));
  const edge = (key, x, y, w, h, gx0, gy0, gx1, gy1) => {
    const ec = side(tile, key);
    const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    g.addColorStop(0, rgba(ec, 0.38));
    g.addColorStop(1, rgba(ec, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  };
  edge("top", 0, 0, S, band, 0, 0, 0, band);
  edge("bottom", 0, S - band, S, band, 0, S, 0, S - band);
  edge("left", 0, 0, band, S, 0, 0, band, 0);
  edge("right", S - band, 0, band, S, S, 0, S - band, 0);

  // Grain: scattered ±brightness specks break up the flat fill (deterministic).
  // Kept subtle — enough to read as texture, not static — now that the per-tile
  // directional light (which created visible grid seams between neighbours) is gone.
  const specks = Math.round(S * S * 0.1);
  for (let i = 0; i < specks; i++) {
    const x = (rnd() * S) | 0, y = (rnd() * S) | 0;
    const d = (rnd() - 0.5) * 34;
    const sz = rnd() < 0.14 ? 2 : 1;
    ctx.fillStyle = rgba(shade(base, d), 0.35);
    ctx.fillRect(x, y, sz, sz);
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

// Draw the culled, camera-centered floor. Textured sprite per tile (at its
// rotation) once loaded; flat-color rect until then. `E` = GAME.EFFECTIVE_TILE.
export function drawTiles(k, map, camX, camY, cache, E) {
  if (!map) return;
  const halfW = k.width() / 2, halfH = k.height() / 2;
  const x0 = Math.max(0, Math.floor((camX - halfW) / E) - 1);
  const x1 = Math.min(map.mapSize - 1, Math.ceil((camX + halfW) / E) + 1);
  const y0 = Math.max(0, Math.floor((camY - halfH) / E) - 1);
  const y1 = Math.min(map.mapSize - 1, Math.ceil((camY + halfH) / E) + 1);
  for (let x = x0; x <= x1; x++) {
    const col = map.tileMap[x];
    if (!col) continue;
    for (let y = y0; y <= y1; y++) {
      const t = col[y];
      if (!t) continue;
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
      drawScatter(k, t, x, y, E); // P-natural: sparse ground detail over the tile
    }
  }
}
