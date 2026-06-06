// Shared XP / leveling — pure engine logic used by BOTH single-player
// (`src/scenes/fight.js`) and the authoritative server (`server/combat.js`) so the
// rule can't drift (P10-T4). Previously this function was copy-pasted in both
// places; the SP copy hardcoded the `100` threshold while the server used
// `GAME.XP_PER_LEVEL` — a latent divergence this consolidation removes.

import { GAME } from "./schemas.js";
import { getMonsterStats } from "./stats.js";
import { getMonsterType } from "./gamedata.js";

/**
 * Add XP to a monster instance, applying any level-ups. On each level gained the
 * monster is restored to its new max HP/energy. Mutates `inst`; caller persists.
 * @param {{xp?:number, level:number, typeName:string, currentHealth:number, currentEnergy:number}} inst
 * @param {number} amount  XP to add (≥0).
 * @returns {boolean} true if at least one level was gained.
 */
export function grantXp(inst, amount) {
  inst.xp = (inst.xp || 0) + amount;
  let leveled = false;
  while (inst.xp >= GAME.XP_PER_LEVEL) {
    inst.xp -= GAME.XP_PER_LEVEL;
    inst.level += 1;
    leveled = true;
    const st = getMonsterStats(getMonsterType(inst.typeName), inst.level);
    inst.currentHealth = st.health;
    inst.currentEnergy = st.energy;
  }
  return leveled;
}
