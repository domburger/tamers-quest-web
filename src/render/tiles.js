// Floor-tile detail (user request 2026-06-06). The map view used to draw each
// tile as one flat rect of its `colorProfile_full`, so floors looked featureless.
// This restores depth: a procedurally-textured sprite per tile *type* (grain),
// drawn at the tile's rotation. Generated once per type and cached, so the draw
// cost stays one sprite per tile (same as the old flat rect). A flat-color rect
// is drawn as a fallback for the frame or two before a type's sprite finishes
// loading. Self-contained (no engine/scene imports) to limit merge conflicts.
// (TQ-407: the per-side edge-colour concept — colorProfile_top/bottom/left/right —
// was removed game-wide; a tile is just its full base colour + texture + grain.)

const TEX = 64; // generated texture resolution (scaled to the tile's screen size)

// TQ-449: floor tiles overlap + cross-fade into each other instead of meeting at a hard grid seam.
// A soft alpha falloff is baked into the rim of each floor tile texture (TILE_FEATHER of TEX, per edge);
// the sprite is then drawn oversized (TILE_DRAW_SCALE) so the still-opaque core fully covers the cell
// (plus TILE_OVERLAP overlap so rounding never leaves a transparent gap) while the translucent rim bleeds
// over the neighbour. Adjacent tiles each feather into the shared boundary → the seam reads as a fade.
const TILE_FEATHER = 0.12;  // texture-rim alpha falloff, fraction of TEX per edge
const TILE_OVERLAP = 0.04;  // opaque-core overlap into neighbours, fraction of E (seam-gap guard)
// Oversize factor so the opaque core (the un-feathered centre = 1 − 2·TILE_FEATHER of the texture) covers
// E·(1 + TILE_OVERLAP). The feathered rim then extends (TILE_DRAW_SCALE − 1)/2 of E beyond each cell edge.
const TILE_DRAW_SCALE = (1 + TILE_OVERLAP) / (1 - 2 * TILE_FEATHER);

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

  // TQ-393: generated tiles' AUTHORED texture is now free HTML/CSS (`tile.html`), rasterized by
  // ensureTile via src/render/htmlRaster.js — NOT painted here. generateTileTexture is the base/seed
  // renderer only: the base colour + the procedural grain below. (The old shape-layer `visual` paint
  // path was removed with the back-compat path, Dominik 2026-06-16; the per-side edge gradients were
  // removed with the edge-colour concept, TQ-407.)

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

// Per-scene cache of which tile-type sprites are loaded / in flight. `avg` memoizes
// neighbourAvg per floor cell (PV-A3): the map is static for a scene, so the local
// colour average never changes — caching it kills ~7 array allocations per visible
// floor cell *per frame* (GC pressure in the hot draw loop) after the first visit.
export function makeTileCache() {
  return { loaded: new Set(), pending: new Set(), avg: new Map(), scatter: new Map(), voidMote: new Map(), fogMote: new Map() };
}

// TQ-449: carve a soft alpha falloff into the tile texture's border so overlapping floor tiles cross-fade
// into each other (see TILE_FEATHER/TILE_DRAW_SCALE). Carves the rim alpha directly with four edge
// gradients in 'destination-out' (dest.alpha ×= 1 − src.alpha), preserving the opaque core; corners get a
// natural rounded falloff where two edges multiply. Applied once per tile type (in register, the single
// point both the procedural and HTML-raster paths converge), NOT in generateTileTexture — so the admin
// tile preview keeps full crisp edges. Self-guarded: a canvas without gradient support is left opaque.
function featherTileEdges(cv) {
  try {
    const S = (cv && cv.width) || 0;
    const ctx = S ? cv.getContext("2d") : null;
    if (!ctx || typeof ctx.createLinearGradient !== "function") return;
    const f = Math.max(1, Math.round(S * TILE_FEATHER));
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "destination-out";
    const edge = (x0, y0, x1, y1, ex, ey, ew, eh) => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, "rgba(0,0,0,1)"); // at the very edge → remove all alpha
      g.addColorStop(1, "rgba(0,0,0,0)"); // f px inward → remove none (opaque core)
      ctx.fillStyle = g;
      ctx.fillRect(ex, ey, ew, eh);
    };
    edge(0, 0, f, 0, 0, 0, f, S);         // left
    edge(S, 0, S - f, 0, S - f, 0, f, S); // right
    edge(0, 0, 0, f, 0, 0, S, f);         // top
    edge(0, S, 0, S - f, 0, S - f, S, f); // bottom
    ctx.globalCompositeOperation = prev;
  } catch { /* canvas without gradient support — leave the tile opaque (hard edges, no crash) */ }
}

// Ensure a tile type's sprite is being generated+loaded; safe to call every frame.
// TQ-393: a generated tile may carry a free HTML/CSS ground texture (`html`, the new builder output).
// When present, rasterize it ONCE to the TEX canvas via the shared foreignObject raster and use THAT as
// the sprite (falling back to the procedural/legacy-visual texture if the raster fails). The raster module
// is loaded with a LAZY dynamic import so this file keeps NO top-level import — preserving the import-free
// property the /admin/tiles.js verbatim serve (TQ-370, legacy-tile preview) relies on; the admin never
// renders the live map, so this branch only runs in the game bundle (where the import resolves).
function ensureTile(k, tile, cache) {
  const id = tile.id;
  if (id == null || cache.loaded.has(id) || cache.pending.has(id)) return;
  cache.pending.add(id);
  const register = (cv) => {
    try {
      featherTileEdges(cv); // TQ-449: soft rim so the oversized draw cross-fades into neighbours
      Promise.resolve(k.loadSprite(tileSpriteName(id), cv))
        .then(() => { cache.loaded.add(id); cache.pending.delete(id); })
        .catch(() => { cache.pending.delete(id); });
    } catch { cache.pending.delete(id); }
  };
  if (tile.html && typeof tile.html.base === "string" && tile.html.base.trim()) {
    import("./htmlRaster.js")
      .then(({ rasterizeHtmlModel }) => rasterizeHtmlModel(tile.html, { size: TEX, transparent: false }))
      .then((cv) => register(cv || generateTileTexture(tile))) // raster failed/blank → procedural fallback
      .catch(() => register(generateTileTexture(tile)));
    return;
  }
  let cv = null; try { cv = generateTileTexture(tile); } catch { cv = null; }
  if (cv) register(cv); else cache.pending.delete(id);
}

// Sparse, deterministic ground scatter (pebbles/flecks) over a cell — breaks the
// uniform tile grid for a more natural top-down floor. Seeded per cell → stable +
// non-repeating (unlike the per-type tile texture). Cheap: ~30% of visible cells.
// The scatter is DETERMINISTIC per cell and map-static (the same pebbles every
// frame), so compute its geometry once and memoize it (PV-A3 pattern, mirroring
// neighbourAvg), then just replay the draws each frame. This drops a mulberry32
// closure + ~7 rnd() calls + array allocations PER VISIBLE FLOOR CELL PER FRAME
// from the hot loop. The rnd() consumption order (px, py, shade, radiusX, radiusY)
// is preserved exactly, so the output is byte-identical.
const NO_SCATTER = []; // shared empty list for the ~70% of cells with no scatter — no per-cell alloc
function computeScatter(t, x, y, E) {
  const rnd = mulberry32((x * 73856093) ^ (y * 19349663));
  if (rnd() > 0.3) return NO_SCATTER;
  const base = [t.colorProfile_full_r || 60, t.colorProfile_full_g || 60, t.colorProfile_full_b || 60];
  const n = rnd() < 0.25 ? 2 : 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const px = x * E + 4 + rnd() * (E - 8);
    const py = y * E + 4 + rnd() * (E - 8);
    const c = shade(base, rnd() < 0.5 ? -30 : 24); // pebble (darker) or fleck (lighter)
    const rx = 2 + rnd() * 1.5, ry = 1.4 + rnd();  // radiusX before radiusY — same order as the old inline draw
    out.push({ px, py, rx, ry, r: c[0], g: c[1], b: c[2] });
  }
  return out;
}
function drawScatter(k, t, x, y, E, cache, mapSize) {
  let list;
  if (cache && cache.scatter) {
    const key = x * mapSize + y; // collision-free per-cell key (scatter only runs on in-grid floor cells) — same scheme as neighbourAvg
    list = cache.scatter.get(key);
    if (list === undefined) { list = computeScatter(t, x, y, E); cache.scatter.set(key, list); }
  } else {
    list = computeScatter(t, x, y, E);
  }
  for (const s of list) k.drawEllipse({ pos: k.vec2(s.px, s.py), radiusX: s.rx, radiusY: s.ry, color: k.rgb(s.r, s.g, s.b), opacity: 0.5 });
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
// PT1-T11 abyss motes: deterministic per cell + map-static (same motes every frame),
// so compute the geometry once and memoize it (same pattern as the floor scatter),
// then just replay the draws. Drops a mulberry32 closure + ~6 rnd() calls per VOID
// cell per frame — significant in walled caves where much of the view is abyss. The
// vr() consumption order (gate, count, then per-mote mx/my/grey/radius) is preserved
// so output is byte-identical.
const NO_MOTES = []; // shared empty list for cells with no motes — no per-cell alloc
function computeVoidMotes(x, y, E) {
  const vr = mulberry32((x * 374761393) ^ (y * 668265263));
  if (vr() >= 0.4) return NO_MOTES;
  const m = vr() < 0.3 ? 2 : 1;
  const out = [];
  for (let i = 0; i < m; i++) {
    const mx = x * E + 3 + vr() * (E - 6), my = y * E + 3 + vr() * (E - 6), g = 22 + Math.floor(vr() * 14), r = 0.8 + vr() * 1.1;
    out.push({ mx, my, r, cr: g - 4, cg: g - 6, cb: g + 5 });
  }
  return out;
}
function voidMotesFor(x, y, E, cache, mapSize) {
  // Cache in-grid void cells (the border ring + impassable interior tiles like water —
  // the common, persistent abyss); out-of-grid cells (looking past the map edge) are
  // rarer, so compute them uncached to keep the key collision-free (same scheme as the
  // scatter / neighbourAvg caches, which are valid only for in-grid coordinates).
  if (cache && cache.voidMote && x >= 0 && x < mapSize && y >= 0 && y < mapSize) {
    const key = x * mapSize + y;
    let list = cache.voidMote.get(key);
    if (list === undefined) { list = computeVoidMotes(x, y, E); cache.voidMote.set(key, list); }
    return list;
  }
  return computeVoidMotes(x, y, E);
}
function drawVoidCell(k, map, x, y, E, cache) {
  const px = x * E, py = y * E;
  k.drawRect({ pos: k.vec2(px, py), width: E, height: E, color: k.rgb(11, 10, 16) }); // abyss
  for (const mo of voidMotesFor(x, y, E, cache, map.mapSize))
    k.drawEllipse({ pos: k.vec2(mo.mx, mo.my), radiusX: mo.r, radiusY: mo.r, color: k.rgb(mo.cr, mo.cg, mo.cb), opacity: 0.5 }); // drawEllipse (matches drawScatter; drawCircle not in the tiles test mock)
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

// TQ-360: an impassable IN-GRID cell (collidable tile — the former-void boundary, or in-map water)
// drawn as recessed solid terrain: the tile's OWN colour darkened so it reads as an impassable wall
// (not walkable floor), plus the same thin wall bands hugging any adjacent floor edge as the abyss used
// — so the boundary outline language is unchanged, only the black abyss becomes real terrain. Off-grid
// cells (no tile) still use drawVoidCell (true abyss past the map edge).
function drawBoundaryTile(k, map, x, y, E, t) {
  const px = x * E, py = y * E;
  // Darken the tile's full colour to ~half so an impassable cell never reads as bright walkable floor.
  const r = Math.round((t.colorProfile_full_r ?? 20) * 0.5);
  const g = Math.round((t.colorProfile_full_g ?? 18) * 0.5);
  const b = Math.round((t.colorProfile_full_b ?? 26) * 0.5);
  k.drawRect({ pos: k.vec2(px, py), width: E, height: E, color: k.rgb(r, g, b) });
  const T = WALL_T(E), wall = k.rgb(46, 41, 54);
  if (isFloor(map, x, y - 1)) k.drawRect({ pos: k.vec2(px, py), width: E, height: T, color: wall });
  if (isFloor(map, x, y + 1)) k.drawRect({ pos: k.vec2(px, py + E - T), width: E, height: T, color: wall });
  if (isFloor(map, x - 1, y)) k.drawRect({ pos: k.vec2(px, py), width: T, height: E, color: wall });
  if (isFloor(map, x + 1, y)) k.drawRect({ pos: k.vec2(px + E - T, py), width: T, height: E, color: wall });
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

// Fog-of-war veil colour for unexplored cells (near-black; reads as the same
// dark unknown as the off-map abyss). FOG_EDGE is a touch lighter — used on the
// 1-cell ring bordering explored ground so the fog reads as receding mist rather
// than a hard checkerboard line (soft-edge polish on PT1-T08 / #5). Anchored on
// PAL.bgAlt / PAL.surface so the fog tracks the cave palette (file is intentionally
// import-free per its design note — values mirrored from theme.js).
const FOG_COLOR = [7, 6, 16];   // PAL.bgAlt
const FOG_EDGE = [22, 19, 31];  // PAL.surface (the faintly-lit ring just inside the fog)

// #70 deep-fog motes: deterministic per cell + map-static (the same mote every frame), so compute the
// geometry once and memoize it (same pattern as the floor scatter / void motes), then just replay the
// draw — dropping a mulberry32 closure + up to 4 rnd() calls per DEEP-FOG cell per frame from the hot
// loop. Much of a freshly-entered round's view is deep fog, so this is a real per-frame saving. The
// fogR() consumption order (gate, then mx/my/rr) and the gate threshold are preserved, so a cell either
// has the SAME single mote as before or none — output is byte-identical. The dynamic f<0.34 gate (which
// changes as the player explores) still runs per frame in drawTiles; only the static geometry is cached.
const NO_FOG_MOTE = null; // shared "no mote" sentinel — no per-cell alloc
function computeFogMote(x, y, E) {
  const fogR = mulberry32((x * 2246822519) ^ (y * 3266489917));
  if (fogR() >= 0.1) return NO_FOG_MOTE; // ~90% of deep-fog cells carry no mote (gate < 0.1 to proceed)
  const mx = x * E + 4 + fogR() * (E - 8), my = y * E + 4 + fogR() * (E - 8), rr = 1 + fogR() * 0.8;
  return { mx, my, rr };
}
function fogMoteFor(x, y, E, cache, mapSize) {
  // Cache only in-grid cells (collision-free key, same scheme as scatter/voidMote); out-of-grid fog
  // (looking past the map edge) is rarer and computed uncached.
  if (cache && cache.fogMote && x >= 0 && x < mapSize && y >= 0 && y < mapSize) {
    const key = x * mapSize + y;
    let mote = cache.fogMote.get(key);
    if (mote === undefined) { mote = computeFogMote(x, y, E); cache.fogMote.set(key, mote); }
    return mote;
  }
  return computeFogMote(x, y, E);
}

// Draw the culled, camera-centered floor + the enclosing void. Textured sprite
// per tile (at its rotation) once loaded; flat-color rect until then. `E` = GAME.EFFECTIVE_TILE.
// `isExplored(x,y)` (optional): fog-of-war gate — when given, a cell the player
// hasn't revealed yet renders as a flat dark veil instead of its tile/void (and the
// detail rendering is skipped, so it's also cheaper). Omit it for no fog.
export function drawTiles(k, map, camX, camY, cache, E, isExplored = null) {
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
      if (isExplored && !isExplored(x, y)) {
        // Fog of war: an unexplored cell is a dark veil until you walk near it. Blend
        // FOG_COLOR→FOG_EDGE by how many of the 8 neighbours are explored, so the
        // boundary fades as a soft graded mist (not a hard line, not a flat ring).
        let exN = 0;
        if (isExplored(x + 1, y)) exN++; if (isExplored(x - 1, y)) exN++;
        if (isExplored(x, y + 1)) exN++; if (isExplored(x, y - 1)) exN++;
        if (isExplored(x + 1, y + 1)) exN++; if (isExplored(x - 1, y - 1)) exN++;
        if (isExplored(x + 1, y - 1)) exN++; if (isExplored(x - 1, y + 1)) exN++;
        const f = Math.min(1, exN / 3); // 0 = deep fog, 1 (≥3 explored neighbours) = edge mist
        const fr = FOG_COLOR[0] + (FOG_EDGE[0] - FOG_COLOR[0]) * f;
        const fg = FOG_COLOR[1] + (FOG_EDGE[1] - FOG_COLOR[1]) * f;
        const fb = FOG_COLOR[2] + (FOG_EDGE[2] - FOG_COLOR[2]) * f;
        k.drawRect({ pos: k.vec2(x * E, y * E), width: E, height: E, color: k.rgb(fr, fg, fb) });
        // #70: faint misty motes in DEEP fog (skip the lit edge ring, where the graded
        // mist already carries the read) so the unexplored expanse reads as cave depth you
        // haven't lit yet — not a flat black gap. Sparse (~10% of cells) + deterministic
        // per cell (stable, non-repeating), mirroring the void/abyss motes but fainter.
        if (f < 0.34) {
          const mote = fogMoteFor(x, y, E, cache, map.mapSize); // geometry memoized per cell (the f<0.34 gate stays dynamic)
          if (mote) k.drawEllipse({ pos: k.vec2(mote.mx, mote.my), radiusX: mote.rr, radiusY: mote.rr * 0.85, color: k.rgb(30, 26, 44), opacity: 0.4 });
        }
        continue;
      }
      const t = (col && y >= 0 && y < map.mapSize) ? col[y] : null;
      if (!t) {
        // Beyond the grid (looking past the map edge) — the true off-map abyss.
        drawVoidCell(k, map, x, y, E, cache); // abyss + thin wall hugging any floor edge (motes memoized per cell)
        continue;
      }
      if (t.collidable) {
        // TQ-360: an impassable in-grid cell (former-void boundary OR in-map water, collidable:1) now
        // SHOWS its tile — recessed solid terrain (darkened tile colour + thin wall edges hugging the
        // floor) instead of a black abyss, so the world reads as solid ground with explicit walls and
        // collision still matches what the player sees (no invisible wall).
        drawBoundaryTile(k, map, x, y, E, t);
        continue;
      }
      ensureTile(k, t, cache);
      if (t.id != null && cache.loaded.has(t.id)) {
        const D = E * TILE_DRAW_SCALE;
        k.drawSprite({
          sprite: tileSpriteName(t.id),
          pos: k.vec2(x * E + E / 2, y * E + E / 2),
          anchor: "center",
          angle: t.rotation || 0,
          width: D, height: D, // TQ-449: oversized so the feathered rim overlaps + cross-fades into neighbours
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
      // Memoized per cell (PV-A3) — the average is map-static, so compute it once and
      // reuse across frames; `undefined` = not yet computed, `null` = no neighbours.
      let avg;
      if (cache && cache.avg) {
        const akey = x * map.mapSize + y;
        avg = cache.avg.get(akey);
        if (avg === undefined) { avg = neighborAvg(map, x, y); cache.avg.set(akey, avg); }
      } else {
        avg = neighborAvg(map, x, y);
      }
      if (avg && (Math.abs(avg[0] - t.colorProfile_full_r) > 2 || Math.abs(avg[1] - t.colorProfile_full_g) > 2 || Math.abs(avg[2] - t.colorProfile_full_b) > 2))
        k.drawRect({ pos: k.vec2(x * E, y * E), width: E, height: E, color: k.rgb(avg[0], avg[1], avg[2]), opacity: 0.22 });
      drawScatter(k, t, x, y, E, cache, map.mapSize); // P-natural: sparse ground detail over the tile (geometry memoized per cell)
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

// Terrain mood wash (PAL.bgAlt at ~34% over the floor). Bumps the bright raw biome
// tiles into the dark theme — same dark base as FOG_COLOR so the cave reads as one
// continuous near-black violet. Lower `a` for a brighter cave, raise for darker.
const FLOOR_MOOD = { r: 7, g: 6, b: 16, a: 0.34 }; // PAL.bgAlt
