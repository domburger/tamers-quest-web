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

/**
 * Restore one monster instance to its level's max HP/energy and clear status.
 * Used on run extraction (survivors heal). Mutates `inst`.
 * @param {{typeName:string, level:number, currentHealth:number, currentEnergy:number, status?:any}} inst
 */
export function healToFull(inst) {
  const st = getMonsterStats(getMonsterType(inst.typeName), inst.level);
  inst.currentHealth = st.health;
  inst.currentEnergy = st.energy;
  inst.status = null;
  return inst;
}

/**
 * Heal a whole team to full (P10-T3 parity: both the server's extract path and
 * single-player `endRunStakes` heal survivors on extract via this one helper, so
 * they can't drift). Mutates each member; returns the team.
 * @param {Array} team  activeMonsters
 */
export function healTeam(team) {
  for (const m of team || []) healToFull(m);
  return team;
}
