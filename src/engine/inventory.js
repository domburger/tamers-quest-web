// Shared inventory/collection rules — the start of the INV-T1 inventory engine
// (PT2-T11 PARITY-3). Pure, framework-agnostic, so single-player (`fight.js`) and
// the authoritative server (`world.js`) place caught monsters by ONE rule and the
// vault cap can't drift between the two modes.

import { GAME } from "./schemas.js";
import { vaultCapacity } from "./upgrades.js";

/**
 * Place a freshly-caught monster into a player's collection:
 *   - into the **active team** if there's room (< TEAM_SIZE), else
 *   - into the **vault** if it's under the player's capacity (base VAULT_SIZE +
 *     Deep Vault upgrade), else
 *   - **released** — a full vault drops the catch (same outcome as a capture
 *     failing), so repeated catches with a full team can't grow the profile without
 *     bound (the catch-path twin of the NC-5 PvP-loot cap).
 * Mutates `profile` (creates the arrays if missing). Returns where it landed so the
 * caller can show the right message: `"team" | "vault" | "released"`.
 * @param {{activeMonsters?:Array, vaultMonsters?:Array, upgrades?:object}} profile
 * @param {object} mon  the caught monster instance
 * @returns {"team"|"vault"|"released"}
 */
export function addCaughtMonster(profile, mon) {
  profile.activeMonsters = profile.activeMonsters || [];
  if (profile.activeMonsters.length < GAME.TEAM_SIZE) {
    profile.activeMonsters.push(mon);
    return "team";
  }
  profile.vaultMonsters = profile.vaultMonsters || [];
  if (profile.vaultMonsters.length < vaultCapacity(profile, GAME.VAULT_SIZE)) {
    profile.vaultMonsters.push(mon);
    return "vault";
  }
  return "released";
}
