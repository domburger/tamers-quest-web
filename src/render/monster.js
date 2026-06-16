// THE standardized way to DRAW a generated monster's sprite with one of the standard animations
// (idle | walk | attack — see src/systems/monsterAnim.js). Every animated draw site (overworld
// wild monsters, the combat battle stage) routes through here, so a monster's three clips look
// identical everywhere and the animation logic lives in exactly one place.
//
// The monster's appearance is its single baked sprite (spritegen.generateMonsterSprite, registered
// under the typeName slug); this helper just applies the per-frame transform from monsterAnim when
// drawing it. (x,y) is the monster's CENTRE; `size` is the drawn pixel size (width & height).

import { monsterAnimTransform } from "../systems/monsterAnim.js";
import { htmlIconImage } from "./htmlIconRaster.js"; // TQ-373: cached raster of a generated monster's authored html visual, for the icon grids
import { getMonsterType } from "../engine/gamedata.js"; // resolve a type to check for an authored html-model
import { hasHtmlModel } from "../systems/htmlModel.js"; // a generated monster's REAL appearance is its html-model, not the generic baked sprite

// slugOf runs per visible monster per frame (drawMonster derives the sprite key from
// typeName), so memoize it — typeNames are a small, bounded per-round set, so the cache
// stays tiny and every later lookup is an O(1) Map hit instead of a String + regex pass.
// Exported as the canonical sprite-key derivation so other draw sites (battleStage)
// share the one memo cache instead of re-deriving the slug with their own closures.
const _slugCache = new Map();
export const slugOf = (typeName) => {
  const key = typeName || "";
  let s = _slugCache.get(key);
  if (s === undefined) { s = String(key).toLowerCase().replace(/\s+/g, "_"); _slugCache.set(key, s); }
  return s;
};

// TQ-351: the topmost OPAQUE row of a baked sprite, as a 0..1 fraction of the canvas height — i.e. how
// far down the visible art starts. Icon/inventory displays (roster, profile team, …) blit the fixed
// 128²(×RES) canvas at a constant scale; a TALL monster whose art reaches the canvas top then bleeds
// ABOVE the card frame. Measuring the art's top lets drawMonsterIcon shrink ONLY the tall ones to fit,
// leaving compact monsters at their normal size. Scanned once per sprite (alpha), then cached. Returns
// 0.5 (≈ "no shrink") when the texture/pixels aren't readable, so a measure failure never regresses.
const _artTop = new Map();
function artTopFrac(k, key, img) {
  if (_artTop.has(key)) return _artTop.get(key);
  let frac = 0.5;
  try {
    const im = img || (k.textures && k.textures.get ? k.textures.get(key) : null);
    const w = im && (im.width || im.naturalWidth), h = im && (im.height || im.naturalHeight);
    if (im && im.getContext && w && h) {
      const data = im.getContext("2d").getImageData(0, 0, w, h).data;
      let top = -1;
      outer: for (let y = 0; y < h; y++) { const row = y * w * 4; for (let x = 0; x < w; x++) { if (data[row + x * 4 + 3] > 16) { top = y; break outer; } } }
      if (top >= 0) frac = Math.max(0, Math.min(0.5, top / h));
    }
  } catch { /* tainted / no DOM — keep 0.5 (no shrink) */ }
  _artTop.set(key, frac);
  return frac;
}

// TQ-351: draw a monster's baked sprite as an ICON, shrinking it ONLY if its art would bleed above
// `topY`. Compact monsters keep `scale` (their current size); a tall monster is scaled down just enough
// to keep its art-top at/below topY. Square (canvas is square, matching drawMonster). Use for inventory/
// icon grids — NOT the overworld/combat, which keep drawMonster's full-size animated draw (user 2026-06-15).
// TQ-373: html-model (AI-generated) monsters carry no baked sprite — they render via the live-DOM
// overlay in the overworld/combat/detail popup, but the canvas icon GRIDS (roster, bestiary, lobby
// team slots, profile) can't show a live-DOM node per cell, so those cards drew NOTHING (blank).
// Until the icon path can render the authored html visual (a pooled multi-node live-DOM icon layer —
// rasterizing monster.html via SVG <foreignObject> is unreliable: Chromium draws it blank for
// security), give the icon a deterministic tinted EMBLEM (a soft blob + eyes, the same shape
// drawMonster paints in the overworld when a sprite is missing) so a generated monster's card is
// never blank and each reads as visually distinct. Seed monsters (baked sprite) are unchanged.
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

export function drawMonsterIcon(k, { sprite, typeName, cx, cy, scale = 1, topY, fixed = false, opacity = 1 }) {
  const key = sprite || slugOf(typeName);
  // A GENERATED monster's REAL appearance is its authored html-model, NOT the generic procedural baked
  // sprite (spritegen registers one for every type, so it would otherwise win here and show a generic
  // "fallback" creature in every icon grid — roster/vault/bestiary/charselect/profile/combat-portrait —
  // even though the overworld/combat live-DOM paths show the real model). So when the type HAS an html
  // model, prefer its cached raster (htmlIconRaster); while that raster is loading (or if it can't
  // rasterize), draw the tinted emblem rather than the misleading generic sprite.
  const mt = typeName ? getMonsterType(typeName) : null;
  if (mt && hasHtmlModel(mt)) {
    const hi = htmlIconImage(typeName);
    if (hi) {
      const top = artTopFrac(k, "htmlicon:" + key, hi); // shrink ONLY tall art (same rule as baked), scanning the raster's alpha
      let D = scale * (hi.width || 256);
      const headroom = cy - topY;
      if (top < 0.5 && headroom > 0) D = Math.min(D, headroom / (0.5 - top)); // keep art-top ≥ topY
      try { k.drawSprite({ image: hi, pos: k.vec2(cx, cy), anchor: "center", width: D, height: D, opacity, fixed }); return true; }
      catch { /* fall through to the emblem */ }
    }
    drawIconEmblem(k, typeName || key, cx, cy, scale * 128 * 0.42, opacity, fixed); return false;
  }
  // No html-model → the baked procedural sprite (or the emblem if it isn't registered yet).
  const img = k.textures && k.textures.get ? k.textures.get(key) : null;
  if (!img) { drawIconEmblem(k, typeName || key, cx, cy, scale * 128 * 0.42, opacity, fixed); return false; }
  const natW = (img && (img.width || img.naturalWidth)) || 128;
  const top = artTopFrac(k, key, img);
  let D = scale * natW;
  const headroom = cy - topY;
  if (top < 0.5 && headroom > 0) D = Math.min(D, headroom / (0.5 - top)); // shrink so art-top ≥ topY
  try { k.drawSprite({ sprite: key, pos: k.vec2(cx, cy), anchor: "center", width: D, height: D, opacity, fixed }); return true; }
  catch { drawIconEmblem(k, typeName || key, cx, cy, scale * 128 * 0.42, opacity, fixed); return false; }
}

/**
 * Draw a monster's baked sprite with a standard animation clip.
 *
 * @param {object} k  Kaboom/Phaser-shim context
 * @param {object} o
 * @param {string} [o.sprite]   sprite key; if absent, derived from o.typeName via the slug
 * @param {string} [o.typeName] monster typeName (used to derive the sprite key + fallback)
 * @param {number} o.x          centre x (design units)
 * @param {number} o.y          centre y
 * @param {number} o.size       drawn size in px (width = height)
 * @param {string} [o.anim]     "idle" (default) | "walk" | "attack"
 * @param {number} [o.t]        seconds clock (k.time()) for the looping clips
 * @param {number} [o.phase]    0..1 progress of a one-shot ATTACK clip
 * @param {number} [o.facing]   +1 right (default) | -1 left — directional lean/lunge
 * @param {number} [o.opacity]
 * @param {boolean} [o.fixed]   screen-space (combat stage) vs world-space (overworld)
 * @param {number[]} [o.tint]   fallback blob colour when the sprite isn't registered yet
 * @returns {boolean} true if the real sprite drew, false if it fell back to the blob
 */
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
    // Sprite not registered. Seed monsters never reach here — their sprite is baked synchronously at
    // boot. AI/generated monsters carry an HTML model and render via the live-DOM overlay (TQ-262), not
    // this canvas path; for them (or any sprite-less monster) the tinted blob below is the placeholder.
    // (TQ-264: the old SVG→sprite lazy rasterize was removed with the SVG render path.)
    // A glowing element-tinted blob keeps the scene from looking empty (mirrors the prior inline fallbacks).
    if (tint) {
      k.drawCircle({ pos: k.vec2(cx, cy), radius: w * 0.42, color: k.rgb(tint[0], tint[1], tint[2]), opacity: 0.9 * opacity, fixed });
      k.drawCircle({ pos: k.vec2(cx - w * 0.13, cy - h * 0.08), radius: w * 0.07, color: k.rgb(255, 255, 255), opacity: 0.9 * opacity, fixed });
      k.drawCircle({ pos: k.vec2(cx + w * 0.13, cy - h * 0.08), radius: w * 0.07, color: k.rgb(255, 255, 255), opacity: 0.9 * opacity, fixed });
    }
    return false;
  }
}
