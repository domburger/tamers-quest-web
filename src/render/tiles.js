// Keep import-free: server/index.js serves this file verbatim to /admin.

const TEX = 64;

const TILE_FEATHER = 0.12;
const TILE_OVERLAP = 0.04;
const TILE_DRAW_SCALE = (1 + TILE_OVERLAP) / (1 - 2 * TILE_FEATHER);

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const shade = (c, d) => [clamp255(c[0] + d), clamp255(c[1] + d), clamp255(c[2] + d)];
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

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

export function generateTileTexture(tile, S = TEX) {
  const c = makeCanvas(S, S);
  const ctx = c.getContext("2d");
  const base = full(tile);
  const rnd = mulberry32((tile.id || 1) * 2654435761);

  ctx.fillStyle = rgba(base, 1);
  ctx.fillRect(0, 0, S, S);

  const specks = Math.round(S * S * 0.16);
  for (let i = 0; i < specks; i++) {
    const x = (rnd() * S) | 0, y = (rnd() * S) | 0;
    const d = (rnd() - 0.5) * 42;
    const sz = rnd() < 0.10 ? 2 : 1;
    ctx.fillStyle = rgba(shade(base, d), 0.30);
    ctx.fillRect(x, y, sz, sz);
  }
  const glints = Math.round(S * S * 0.012);
  for (let i = 0; i < glints; i++) {
    const x = (rnd() * S) | 0, y = (rnd() * S) | 0;
    ctx.fillStyle = rgba(shade(base, 60), 0.22);
    ctx.fillRect(x, y, 1, 1);
  }

  return c;
}

export function makeTileCache() {
  return { loaded: new Set(), pending: new Set(), avg: new Map(), scatter: new Map(), voidMote: new Map(), fogMote: new Map() };
}

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
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(ex, ey, ew, eh);
    };
    edge(0, 0, f, 0, 0, 0, f, S);
    edge(S, 0, S - f, 0, S - f, 0, f, S);
    edge(0, 0, 0, f, 0, 0, S, f);
    edge(0, S, 0, S - f, 0, S - f, S, f);
    ctx.globalCompositeOperation = prev;
  } catch {}
}

function ensureTile(k, tile, cache) {
  const id = tile.id;
  if (id == null || cache.loaded.has(id) || cache.pending.has(id)) return;
  cache.pending.add(id);
  const register = (cv) => {
    try {
      featherTileEdges(cv);
      Promise.resolve(k.loadSprite(tileSpriteName(id), cv))
        .then(() => { cache.loaded.add(id); cache.pending.delete(id); })
        .catch(() => { cache.pending.delete(id); });
    } catch { cache.pending.delete(id); }
  };
  if (tile.html && typeof tile.html.base === "string" && tile.html.base.trim()) {
    import("./htmlRaster.js")
      .then(({ rasterizeHtmlModel }) => rasterizeHtmlModel(tile.html, { size: TEX, transparent: false }))
      .then((cv) => register(cv || generateTileTexture(tile)))
      .catch(() => register(generateTileTexture(tile)));
    return;
  }
  let cv = null; try { cv = generateTileTexture(tile); } catch { cv = null; }
  if (cv) register(cv); else cache.pending.delete(id);
}

const NO_SCATTER = [];
function computeScatter(t, x, y, E) {
  const rnd = mulberry32((x * 73856093) ^ (y * 19349663));
  if (rnd() > 0.3) return NO_SCATTER;
  const base = [t.colorProfile_full_r || 60, t.colorProfile_full_g || 60, t.colorProfile_full_b || 60];
  const n = rnd() < 0.25 ? 2 : 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const px = x * E + 4 + rnd() * (E - 8);
    const py = y * E + 4 + rnd() * (E - 8);
    const c = shade(base, rnd() < 0.5 ? -30 : 24);
    const rx = 2 + rnd() * 1.5, ry = 1.4 + rnd();
    out.push({ px, py, rx, ry, r: c[0], g: c[1], b: c[2] });
  }
  return out;
}
function drawScatter(k, t, x, y, E, cache, mapSize) {
  let list;
  if (cache && cache.scatter) {
    const key = x * mapSize + y;
    list = cache.scatter.get(key);
    if (list === undefined) { list = computeScatter(t, x, y, E); cache.scatter.set(key, list); }
  } else {
    list = computeScatter(t, x, y, E);
  }
  for (const s of list) k.drawEllipse({ pos: k.vec2(s.px, s.py), radiusX: s.rx, radiusY: s.ry, color: k.rgb(s.r, s.g, s.b), opacity: 0.5 });
}

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

// Must match collision walkability (in-grid && !collidable).
const isFloor = (map, x, y) =>
  x >= 0 && x < map.mapSize && y >= 0 && y < map.mapSize &&
  map.tileMap[x] && map.tileMap[x][y] != null && !map.tileMap[x][y].collidable;

const NO_MOTES = [];
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
  // Cache in-grid cells only: the x*mapSize+y key collides outside the grid.
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
  k.drawRect({ pos: k.vec2(px, py), width: E, height: E, color: k.rgb(11, 10, 16) });
  for (const mo of voidMotesFor(x, y, E, cache, map.mapSize))
    k.drawEllipse({ pos: k.vec2(mo.mx, mo.my), radiusX: mo.r, radiusY: mo.r, color: k.rgb(mo.cr, mo.cg, mo.cb), opacity: 0.5 }); // drawEllipse, not drawCircle: the tiles test mock has no drawCircle.
}

const COLLIDABLE_DARK = 0.4;
function drawCollidableShade(k, x, y, E, t, cache) {
  const px = x * E, py = y * E;
  ensureTile(k, t, cache);
  if (t.id != null && cache && cache.loaded.has(t.id)) {
    k.drawSprite({ sprite: tileSpriteName(t.id), pos: k.vec2(px + E / 2, py + E / 2), anchor: "center", angle: t.rotation || 0, width: E, height: E });
    k.drawRect({ pos: k.vec2(px, py), width: E, height: E, color: k.rgb(0, 0, 0), opacity: 1 - COLLIDABLE_DARK });
    return;
  }
  const r = Math.round((t.colorProfile_full_r ?? 20) * COLLIDABLE_DARK);
  const g = Math.round((t.colorProfile_full_g ?? 18) * COLLIDABLE_DARK);
  const b = Math.round((t.colorProfile_full_b ?? 26) * COLLIDABLE_DARK);
  k.drawRect({ pos: k.vec2(px, py), width: E, height: E, color: k.rgb(r, g, b) });
}

function drawFloorEdgeShadow(k, map, x, y, E) {
  const px = x * E, py = y * E, t = Math.max(3, E * 0.16), col = k.rgb(0, 0, 0), op = 0.34;
  const up = !isFloor(map, x, y - 1), dn = !isFloor(map, x, y + 1);
  const lf = !isFloor(map, x - 1, y), rt = !isFloor(map, x + 1, y);
  if (up) k.drawRect({ pos: k.vec2(px, py), width: E, height: t, color: col, opacity: op });
  if (dn) k.drawRect({ pos: k.vec2(px, py + E - t), width: E, height: t, color: col, opacity: op });
  const iy = py + (up ? t : 0), ih = E - (up ? t : 0) - (dn ? t : 0);
  if (lf) k.drawRect({ pos: k.vec2(px, iy), width: t, height: ih, color: col, opacity: op });
  if (rt) k.drawRect({ pos: k.vec2(px + E - t, iy), width: t, height: ih, color: col, opacity: op });
  const corner = (cx, cy) => k.drawRect({ pos: k.vec2(cx, cy), width: t, height: t, color: col, opacity: op });
  if (!up && !rt && !isFloor(map, x + 1, y - 1)) corner(px + E - t, py);
  if (!up && !lf && !isFloor(map, x - 1, y - 1)) corner(px, py);
  if (!dn && !rt && !isFloor(map, x + 1, y + 1)) corner(px + E - t, py + E - t);
  if (!dn && !lf && !isFloor(map, x - 1, y + 1)) corner(px, py + E - t);
}

const FOG_COLOR = [7, 6, 16];
const FOG_EDGE = [22, 19, 31];

const NO_FOG_MOTE = null;
function computeFogMote(x, y, E) {
  const fogR = mulberry32((x * 2246822519) ^ (y * 3266489917));
  if (fogR() >= 0.1) return NO_FOG_MOTE;
  const mx = x * E + 4 + fogR() * (E - 8), my = y * E + 4 + fogR() * (E - 8), rr = 1 + fogR() * 0.8;
  return { mx, my, rr };
}
function fogMoteFor(x, y, E, cache, mapSize) {
  if (cache && cache.fogMote && x >= 0 && x < mapSize && y >= 0 && y < mapSize) {
    const key = x * mapSize + y;
    let mote = cache.fogMote.get(key);
    if (mote === undefined) { mote = computeFogMote(x, y, E); cache.fogMote.set(key, mote); }
    return mote;
  }
  return computeFogMote(x, y, E);
}

export function drawTiles(k, map, camX, camY, cache, E, isExplored = null, opts = null) {
  if (!map) return;
  const endless = !!(opts && opts.endless), N = map.mapSize;
  const clampI = (v) => (v < 0 ? 0 : v >= N ? N - 1 : v);
  const halfW = k.width() / 2, halfH = k.height() / 2;
  const x0 = Math.floor((camX - halfW) / E) - 1;
  const x1 = Math.ceil((camX + halfW) / E) + 1;
  const y0 = Math.floor((camY - halfH) / E) - 1;
  const y1 = Math.ceil((camY + halfH) / E) + 1;
  // PASS 1 = walkable floor only; fog/void/collidable go in PASS 2 to cover floor rims.
  for (let x = x0; x <= x1; x++) {
    const col = (x >= 0 && x < map.mapSize) ? map.tileMap[x] : null;
    for (let y = y0; y <= y1; y++) {
      if (isExplored && !isExplored(x, y)) continue;
      const inGrid = !!col && y >= 0 && y < map.mapSize;
      const t = inGrid ? col[y] : (endless ? map.tileMap[clampI(x)]?.[clampI(y)] : null);
      if (!t || t.collidable) continue;
      ensureTile(k, t, cache);
      if (t.id != null && cache.loaded.has(t.id)) {
        const D = E * TILE_DRAW_SCALE;
        k.drawSprite({
          sprite: tileSpriteName(t.id),
          pos: k.vec2(x * E + E / 2, y * E + E / 2),
          anchor: "center",
          angle: t.rotation || 0,
          width: D, height: D,
        });
      } else {
        k.drawRect({
          pos: k.vec2(x * E, y * E), width: E, height: E,
          color: k.rgb(t.colorProfile_full_r, t.colorProfile_full_g, t.colorProfile_full_b),
        });
      }
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
      drawScatter(k, t, x, y, E, cache, map.mapSize);
    }
  }
  for (let x = x0; x <= x1; x++) {
    const col = (x >= 0 && x < map.mapSize) ? map.tileMap[x] : null;
    for (let y = y0; y <= y1; y++) {
      if (isExplored && !isExplored(x, y)) {
        let exN = 0;
        if (isExplored(x + 1, y)) exN++; if (isExplored(x - 1, y)) exN++;
        if (isExplored(x, y + 1)) exN++; if (isExplored(x, y - 1)) exN++;
        if (isExplored(x + 1, y + 1)) exN++; if (isExplored(x - 1, y - 1)) exN++;
        if (isExplored(x + 1, y - 1)) exN++; if (isExplored(x - 1, y + 1)) exN++;
        const f = Math.min(1, exN / 3);
        const fr = FOG_COLOR[0] + (FOG_EDGE[0] - FOG_COLOR[0]) * f;
        const fg = FOG_COLOR[1] + (FOG_EDGE[1] - FOG_COLOR[1]) * f;
        const fb = FOG_COLOR[2] + (FOG_EDGE[2] - FOG_COLOR[2]) * f;
        k.drawRect({ pos: k.vec2(x * E, y * E), width: E, height: E, color: k.rgb(fr, fg, fb) });
        if (f < 0.34) {
          const mote = fogMoteFor(x, y, E, cache, map.mapSize);
          if (mote) k.drawEllipse({ pos: k.vec2(mote.mx, mote.my), radiusX: mote.rr, radiusY: mote.rr * 0.85, color: k.rgb(30, 26, 44), opacity: 0.4 });
        }
        continue;
      }
      const inGrid = !!col && y >= 0 && y < map.mapSize;
      if (!inGrid && endless) continue;
      const t = inGrid ? col[y] : null;
      if (!t) {
        drawVoidCell(k, map, x, y, E, cache);
        continue;
      }
      if (t.collidable) {
        drawCollidableShade(k, x, y, E, t, cache);
        continue;
      }
      if (!endless || (x > 0 && y > 0 && x < N - 1 && y < N - 1)) drawFloorEdgeShadow(k, map, x, y, E);
    }
  }
  k.drawRect({ pos: k.vec2(0, 0), width: k.width(), height: k.height(),
    color: k.rgb(FLOOR_MOOD.r, FLOOR_MOOD.g, FLOOR_MOOD.b), opacity: FLOOR_MOOD.a, fixed: true });
}

const FLOOR_MOOD = { r: 7, g: 6, b: 16, a: 0.34 };
