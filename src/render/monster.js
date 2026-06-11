// THE standardized way to DRAW a generated monster's sprite with one of the standard animations
// (idle | walk | attack — see src/systems/monsterAnim.js). Every animated draw site (overworld
// wild monsters, the combat battle stage) routes through here, so a monster's three clips look
// identical everywhere and the animation logic lives in exactly one place.
//
// The monster's appearance is its single baked sprite (spritegen.generateMonsterSprite, registered
// under the typeName slug); this helper just applies the per-frame transform from monsterAnim when
// drawing it. (x,y) is the monster's CENTRE; `size` is the drawn pixel size (width & height).

import { monsterAnimTransform } from "../systems/monsterAnim.js";

// slugOf runs per visible monster per frame (drawMonster derives the sprite key from
// typeName), so memoize it — typeNames are a small, bounded per-round set, so the cache
// stays tiny and every later lookup is an O(1) Map hit instead of a String + regex pass.
const _slugCache = new Map();
const slugOf = (typeName) => {
  const key = typeName || "";
  let s = _slugCache.get(key);
  if (s === undefined) { s = String(key).toLowerCase().replace(/\s+/g, "_"); _slugCache.set(key, s); }
  return s;
};

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
    // Sprite not registered (a freeform AI monster whose texture hasn't loaded) — a glowing
    // element-tinted blob keeps the scene from looking empty (mirrors the prior inline fallbacks).
    if (tint) {
      k.drawCircle({ pos: k.vec2(cx, cy), radius: w * 0.42, color: k.rgb(tint[0], tint[1], tint[2]), opacity: 0.9 * opacity, fixed });
      k.drawCircle({ pos: k.vec2(cx - w * 0.13, cy - h * 0.08), radius: w * 0.07, color: k.rgb(255, 255, 255), opacity: 0.9 * opacity, fixed });
      k.drawCircle({ pos: k.vec2(cx + w * 0.13, cy - h * 0.08), radius: w * 0.07, color: k.rgb(255, 255, 255), opacity: 0.9 * opacity, fixed });
    }
    return false;
  }
}
