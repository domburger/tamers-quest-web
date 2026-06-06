// Pure sprint/stamina helpers — framework-agnostic (no engine/DOM deps) so the
// authoritative server and the single-player client share one implementation.
// GAME tunables (GAME.SPRINT) are passed in by the caller.

/**
 * Is the player actually sprinting this frame? Requires the sprint input, that
 * they're moving, and enough stamina. `wasSprinting` adds hysteresis: once you
 * stop sprinting (stamina hits 0), you must regen back to MIN_TO_START to resume,
 * so movement doesn't stutter at empty.
 * @param {{sprint?:boolean, moving:boolean, stamina:number, wasSprinting?:boolean}} o
 * @param {object} GAME
 * @returns {boolean}
 */
export function sprintingNow({ sprint, moving, stamina, wasSprinting = false }, GAME) {
  if (!sprint || !moving) return false;
  const floor = wasSprinting ? 0 : GAME.SPRINT.MIN_TO_START;
  return stamina > floor;
}

/**
 * Advance stamina one step: drain while sprinting, regen otherwise, clamped to
 * [0, STAMINA_MAX].
 * @param {number} stamina
 * @param {boolean} sprinting
 * @param {number} dt seconds
 * @param {object} GAME
 * @returns {number}
 */
export function tickStamina(stamina, sprinting, dt, GAME) {
  const rate = sprinting ? -GAME.SPRINT.DRAIN_PER_S : GAME.SPRINT.REGEN_PER_S;
  const next = (stamina ?? GAME.SPRINT.STAMINA_MAX) + rate * dt;
  return Math.max(0, Math.min(GAME.SPRINT.STAMINA_MAX, next));
}

/** Speed multiplier for this frame given whether the player is sprinting. */
export function sprintMult(sprinting, GAME) {
  return sprinting ? GAME.SPRINT.MULT : 1;
}
