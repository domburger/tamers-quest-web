// Shared XP / leveling — pure engine logic used by BOTH single-player
// (`src/scenes/fight.js`) and the authoritative server (`server/combat.js`) so the
// rule can't drift (P10-T4). Previously this function was copy-pasted in both
// places; the SP copy hardcoded the `100` threshold while the server used
// `GAME.XP_PER_LEVEL` — a latent divergence this consolidation removes.

import { GAME } from "./schemas.js";
import { getMonsterStats } from "./stats.js";
import { getMonsterType } from "./gamedata.js";
import { goldMult } from "./upgrades.js";

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

/**
 * Gold awarded for a successful extraction, scaled by the player's Prospector
 * upgrade. Single source so the SP overworld and the server can't drift on the
 * formula (they previously hardcoded the same `PER_EXTRACT * goldMult` math).
 * @param {{upgrades?:object}} profile
 * @returns {number} gold to grant
 */
export function extractGold(profile) {
  return Math.round(GAME.GOLD.PER_EXTRACT * goldMult(profile));
}

/**
 * Apply the run-extraction rewards to a profile: heal all survivors to full and
 * bank the extract gold bonus. Returns the gold granted. Mutates `profile`.
 * Run-found spirit chains are finalized separately by the caller (which injects
 * its own chain lookup), so this stays engine-pure. (P10-T3: SP `endRunStakes`
 * and the server's `endRunForPlayer` both run through this one helper.)
 * @param {{activeMonsters?:Array, gold?:number, upgrades?:object}} profile
 * @returns {number} gold granted
 */
export function grantExtractRewards(profile) {
  healTeam(profile.activeMonsters);
  const gold = extractGold(profile);
  profile.gold = (profile.gold || 0) + gold;
  return gold;
}
