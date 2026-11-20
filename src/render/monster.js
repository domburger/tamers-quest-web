import { monsterAnimTransform } from "../systems/monsterAnim.js";
import { htmlIconImage } from "./htmlIconRaster.js";
import { getMonsterType } from "../engine/gamedata.js";
import { hasHtmlModel } from "../systems/htmlModel.js";

const _slugCache = new Map();
export const slugOf = (typeName) => {
  const key = typeName || "";
  let s = _slugCache.get(key);
  if (s === undefined) { s = String(key).toLowerCase().replace(/\s+/g, "_"); _slugCache.set(key, s); }
  return s;
};

const _artTop = new Map();
let _lastScanT = -1;
const SCAN = 32;
let _scan = null;
function scanCtx() {
  if (_scan) return _scan;
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas"); c.width = SCAN; c.height = SCAN;
  _scan = c.getContext("2d", { willReadFrequently: true });
  return _scan;
}
function artTopFrac(k, key, img, measure = true) {
  if (_artTop.has(key)) return _artTop.get(key);
  if (img && typeof img._artTop === "number") { _artTop.set(key, img._artTop); return img._artTop; }
  // Never read pixels back when measure is false (fights/HUD): GPU sync stalls frames.
  if (!measure) return 0.5;
  // Max one GPU read-back per frame; grids requesting many at once freeze.
  const now = typeof k.time === "function" ? k.time() : -1;
  if (now >= 0 && now === _lastScanT) return 0.5;
  _lastScanT = now;
  let frac = 0.5;
  try {
    const im = img || (k.textures && k.textures.get ? k.textures.get(key) : null);
    const w = im && (im.width || im.naturalWidth), h = im && (im.height || im.naturalHeight);
    const sc = (im && w && h) ? scanCtx() : null;
    if (sc) {
      sc.clearRect(0, 0, SCAN, SCAN);
      sc.drawImage(im, 0, 0, w, h, 0, 0, SCAN, SCAN);
      const data = sc.getImageData(0, 0, SCAN, SCAN).data;
      let top = -1;
      outer: for (let y = 0; y < SCAN; y++) { const row = y * SCAN * 4; for (let x = 0; x < SCAN; x++) { if (data[row + x * 4 + 3] > 16) { top = y; break outer; } } }
      if (top >= 0) frac = Math.max(0, Math.min(0.5, top / SCAN));
    }
  } catch {}
  _artTop.set(key, frac);
  return frac;
}

const ICON_FALLBACK_PALETTE = [
  [120, 170, 90], [90, 150, 200], [200, 130, 80], [170, 110, 190],
  [90, 180, 170], [200, 100, 110], [150, 160, 90], [110, 140, 210],
];
export function iconTint(typeName) {
  let h = 5381; const s = String(typeName || "");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return ICON_FALLBACK_PALETTE[h % ICON_FALLBACK_PALETTE.length];
}
function drawIconEmblem(k, typeName, cx, cy, R, opacity, fixed) {
  const t = iconTint(typeName);
  k.drawCircle({ pos: k.vec2(cx, cy), radius: R, color: k.rgb(t[0], t[1], t[2]), opacity: 0.92 * opacity, fixed });
  k.drawCircle({ pos: k.vec2(cx - R * 0.3, cy - R * 0.18), radius: R * 0.16, color: k.rgb(255, 255, 255), opacity: 0.92 * opacity, fixed });
  k.drawCircle({ pos: k.vec2(cx + R * 0.3, cy - R * 0.18), radius: R * 0.16, color: k.rgb(255, 255, 255), opacity: 0.92 * opacity, fixed });
}

export function drawMonsterIcon(k, { sprite, typeName, cx, cy, scale = 1, topY, fixed = false, opacity = 1, measure = true }) {
  const key = sprite || slugOf(typeName);
  // Check html-model first: spritegen registers a generic sprite for every type.
  const mt = typeName ? getMonsterType(typeName) : null;
  if (mt && hasHtmlModel(mt)) {
    const hi = htmlIconImage(typeName);
    if (hi) {
      const top = artTopFrac(k, "htmlicon:" + key, hi, measure);
      let D = scale * (hi.width || 256);
      const headroom = cy - topY;
      if (top < 0.5 && headroom > 0) D = Math.min(D, headroom / (0.5 - top));
      try { k.drawSprite({ image: hi, pos: k.vec2(cx, cy), anchor: "center", width: D, height: D, opacity, fixed }); return true; }
      catch {}
    }
    drawIconEmblem(k, typeName || key, cx, cy, scale * 128 * 0.42, opacity, fixed); return false;
  }
  const img = k.textures && k.textures.get ? k.textures.get(key) : null;
  if (!img) { drawIconEmblem(k, typeName || key, cx, cy, scale * 128 * 0.42, opacity, fixed); return false; }
  const natW = (img && (img.width || img.naturalWidth)) || 128;
  const top = artTopFrac(k, key, img, measure);
  let D = scale * natW;
  const headroom = cy - topY;
  if (top < 0.5 && headroom > 0) D = Math.min(D, headroom / (0.5 - top));
  try { k.drawSprite({ sprite: key, pos: k.vec2(cx, cy), anchor: "center", width: D, height: D, opacity, fixed }); return true; }
  catch { drawIconEmblem(k, typeName || key, cx, cy, scale * 128 * 0.42, opacity, fixed); return false; }
}

export function drawMonster(k, { sprite, typeName, x, y, size, anim = "idle", t = 0, phase = 0, facing = 1, opacity = 1, fixed = false, tint = null }) {
  const key = sprite || slugOf(typeName);
  const tr = monsterAnimTransform(anim, t, { phase, facing });
  const w = Math.max(1, size * tr.sx), h = Math.max(1, size * tr.sy);
  const cx = x + tr.dx * size, cy = y + tr.dy * size;
  const angle = (tr.rot * 180) / Math.PI;
  try {
    k.drawSprite({ sprite: key, pos: k.vec2(cx, cy), anchor: "center", width: w, height: h, angle, opacity, fixed });
    return true;
  } catch {
    if (tint) {
      k.drawCircle({ pos: k.vec2(cx, cy), radius: w * 0.42, color: k.rgb(tint[0], tint[1], tint[2]), opacity: 0.9 * opacity, fixed });
      k.drawCircle({ pos: k.vec2(cx - w * 0.13, cy - h * 0.08), radius: w * 0.07, color: k.rgb(255, 255, 255), opacity: 0.9 * opacity, fixed });
      k.drawCircle({ pos: k.vec2(cx + w * 0.13, cy - h * 0.08), radius: w * 0.07, color: k.rgb(255, 255, 255), opacity: 0.9 * opacity, fixed });
    }
    return false;
  }
}
