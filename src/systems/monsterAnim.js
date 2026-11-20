// Pure, no DOM: imported by server/gen.js.

export const MONSTER_ANIMS = ["idle", "walk", "attack"];

export const ATTACK_DURATION = 0.5;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// dx/dy are fractions of the sprite draw size; rot is radians.
export function monsterAnimTransform(anim, t = 0, { phase = 0, facing = 1 } = {}) {
  const f = facing < 0 ? -1 : 1;

  if (anim === "walk") {
    const step = Math.abs(Math.sin(t * 7));
    const rock = Math.sin(t * 3.5);
    return {
      dx: 0,
      dy: -step * 0.06,
      sx: 1 + 0.04 * (1 - step),
      sy: 1 - 0.04 * (1 - step),
      rot: rock * 0.06 * f,
    };
  }

  if (anim === "attack") {
    const p = clamp01(phase);
    let lunge;
    if (p < 0.28) lunge = -0.16 * (p / 0.28);
    else if (p < 0.5) lunge = -0.16 + 0.6 * ((p - 0.28) / 0.22);
    else lunge = 0.44 * (1 - (p - 0.5) / 0.5);
    const windup = p < 0.28 ? p / 0.28 : 0;
    const strike = p >= 0.28 && p < 0.5 ? 1 : 0;
    return {
      dx: lunge * f,
      dy: windup * 0.05,
      sx: 1 + strike * 0.12 - windup * 0.06,
      sy: 1 - strike * 0.06 + windup * 0.08,
      rot: 0,
    };
  }

  const b = Math.sin(t * 2.4);
  return {
    dx: 0,
    dy: b * 0.015,
    sx: 1 - 0.015 * b,
    sy: 1 + 0.02 * b,
    rot: 0,
  };
}

