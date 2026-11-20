export function sprintingNow({ sprint, moving, stamina, wasSprinting = false }, GAME) {
  if (!sprint || !moving) return false;
  const floor = wasSprinting ? 0 : GAME.SPRINT.MIN_TO_START;
  return stamina > floor;
}

export function tickStamina(stamina, sprinting, dt, GAME) {
  const rate = sprinting ? -GAME.SPRINT.DRAIN_PER_S : GAME.SPRINT.REGEN_PER_S;
  const next = (stamina ?? GAME.SPRINT.STAMINA_MAX) + rate * dt;
  return Math.max(0, Math.min(GAME.SPRINT.STAMINA_MAX, next));
}

export function sprintMult(sprinting, GAME) {
  return sprinting ? GAME.SPRINT.MULT : 1;
}
