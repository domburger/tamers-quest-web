// Standardized monster ANIMATION set. Every generated monster's (baked) sprite is animated
// procedurally through this ONE module — no per-monster animation data is authored, so the SAME
// three clips work uniformly for ANY AI-generated creature (the gen pipeline only has to produce a
// renderable sprite; see server/gen.js, which stamps `animations: MONSTER_ANIMS` onto every
// monster so the contract is explicit in the data too).
//
// Three clips for now: IDLE (ambient breathing), WALK (a stepping gait — used when a monster
// approaches the player in the overworld), ATTACK (a one-shot lunge — used in combat).
//
// Pure + framework-free (no DOM, no Kaboom) so the Node server (gen validation) and the client
// renderer (src/render/monster.js drawMonster) both import it safely. The renderer applies the
// returned transform when drawing the monster's sprite — see drawMonster.

export const MONSTER_ANIMS = ["idle", "walk", "attack"];

// One ATTACK clip lasts this long (seconds). The renderer drives the clip with a 0..1 `phase`
// (elapsed / ATTACK_DURATION); a looping clip (idle/walk) ignores phase and reads the free clock.
export const ATTACK_DURATION = 0.5;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The per-frame DRAW TRANSFORM for one monster animation. Pure.
 *
 * @param {string} anim   "idle" | "walk" | "attack" (anything else → idle)
 * @param {number} t      free-running seconds clock (e.g. k.time()) — drives the looping clips
 * @param {object} [o]
 * @param {number} [o.phase]   0..1 progress of a one-shot clip (ATTACK); ignored by idle/walk
 * @param {number} [o.facing]  +1 faces/moves right, -1 left — flips the directional motion
 *                             (the lunge in ATTACK, the rock in WALK). The baked sprite art itself
 *                             faces right; mirroring the texture is the caller's concern (future).
 * @returns {{dx:number,dy:number,sx:number,sy:number,rot:number}}
 *   dx,dy: offset in UNITS OF the draw size (caller multiplies by the sprite size).
 *   sx,sy: scale multipliers (1 = unchanged). rot: rotation in radians.
 */
export function monsterAnimTransform(anim, t = 0, { phase = 0, facing = 1 } = {}) {
  const f = facing < 0 ? -1 : 1;

  if (anim === "walk") {
    // A two-beat stepping bounce + a slight body rock → reads as locomotion (used when a wild
    // monster slowly approaches the player). |sin| gives two bounces per period (left/right step).
    const step = Math.abs(Math.sin(t * 7));   // 0 = foot contact, 1 = mid-stride apex
    const rock = Math.sin(t * 3.5);
    return {
      dx: 0,
      dy: -step * 0.06,                        // bob up to 6% of size at the apex
      sx: 1 + 0.04 * (1 - step),               // squash on contact, neutral at apex
      sy: 1 - 0.04 * (1 - step),
      rot: rock * 0.06 * f,                    // gentle rock in the facing direction
    };
  }

  if (anim === "attack") {
    // One-shot lunge toward `facing`: windup (pull back + crouch) → strike (surge forward +
    // stretch) → recover (ease back to rest). Phase is 0..1 over ATTACK_DURATION.
    const p = clamp01(phase);
    let lunge; // + = forward (toward facing)
    if (p < 0.28) lunge = -0.16 * (p / 0.28);                       // windup: pull back
    else if (p < 0.5) lunge = -0.16 + 0.6 * ((p - 0.28) / 0.22);    // strike: surge forward (→ +0.44)
    else lunge = 0.44 * (1 - (p - 0.5) / 0.5);                       // recover: ease back to 0
    const windup = p < 0.28 ? p / 0.28 : 0;
    const strike = p >= 0.28 && p < 0.5 ? 1 : 0;
    return {
      dx: lunge * f,
      dy: windup * 0.05,                       // dip slightly while winding up
      sx: 1 + strike * 0.12 - windup * 0.06,
      sy: 1 - strike * 0.06 + windup * 0.08,
      rot: 0,
    };
  }

  // idle (default): slow breathing — a gentle vertical bob with a counter-squash.
  const b = Math.sin(t * 2.4); // -1..1
  return {
    dx: 0,
    dy: b * 0.015,
    sx: 1 - 0.015 * b,
    sy: 1 + 0.02 * b,
    rot: 0,
  };
}

// Is `name` one of the standard clips? (Defensive helper for callers / gen validation.)
export function isMonsterAnim(name) {
  return MONSTER_ANIMS.includes(name);
}
