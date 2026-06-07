// Shared inventory/collection rules — the start of the INV-T1 inventory engine
// (PT2-T11 PARITY-3). Pure, framework-agnostic, so single-player (`fight.js`) and
// the authoritative server (`world.js`) place caught monsters by ONE rule and the
// vault cap can't drift between the two modes.

import { GAME } from "./schemas.js";
import { vaultCapacity } from "./upgrades.js";
import { defeatGold, defeatEssence } from "./progression.js";

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

/**
 * Rearrange a profile's roster from a desired active-team id list. The monsters
 * named in `activeIds` (order preserved, deduped, capped at TEAM_SIZE) become the
 * active team; every other owned monster falls to the vault (capped at the player's
 * capacity — base VAULT_SIZE + Deep Vault). Unknown ids are ignored. Mutates
 * `profile` only on success. Single source for SP roster management + the MP
 * `setRoster` handler (PT2-T11 PARITY-3). _(Distinct from `schemas.js clampRoster`,
 * which clamps an already-built roster rather than rebuilding from an id list.)_
 * @returns {boolean} true if a valid roster (≥1 active) was applied; false (no
 *   mutation) otherwise — the active team must never be emptied.
 */
export function applyRoster(profile, activeIds) {
  if (!profile) return false;
  const pool = [...(profile.activeMonsters || []), ...(profile.vaultMonsters || [])];
  const byId = new Map(pool.map((m) => [m.id, m]));
  const seen = new Set();
  const active = [];
  for (const id of Array.isArray(activeIds) ? activeIds : []) {
    if (active.length >= GAME.TEAM_SIZE) break;
    const m = byId.get(id);
    if (m && !seen.has(id)) { seen.add(id); active.push(m); }
  }
  if (active.length === 0) return false;
  profile.activeMonsters = active;
  profile.vaultMonsters = pool.filter((m) => !seen.has(m.id)).slice(0, vaultCapacity(profile, GAME.VAULT_SIZE));
  return true;
}

/**
 * Release an owned monster (INV-T7): remove it from the active team or vault and
 * grant a modest refund — Spirit Essence + level-scaled gold, through the SAME
 * meta-upgrade-scaled helpers a wild defeat uses, so a released monster is worth a
 * consistent (not free) amount. Mutates `profile` (gold/essence + roster arrays).
 * Enforces the keep-≥1-active invariant: if the release empties the active team a
 * vault monster is promoted; releasing the player's *last* monster is refused (no
 * mutation). Pure/shared so SP `inventory.js` and an MP release handler grant the
 * same reward and obey the same guard.
 * @param {{activeMonsters?:Array, vaultMonsters?:Array, gold?:number, essence?:number, upgrades?:object}} profile
 * @param {string} monsterId
 * @returns {{ok:boolean, reason?:string, reward?:{gold:number,essence:number}, from?:"active"|"vault", monster?:object}}
 */
export function releaseMonster(profile, monsterId) {
  if (!profile) return { ok: false, reason: "no-profile" };
  const id = String(monsterId ?? "");
  const active = profile.activeMonsters || (profile.activeMonsters = []);
  const vault = profile.vaultMonsters || (profile.vaultMonsters = []);
  if (active.length + vault.length <= 1) return { ok: false, reason: "last-monster" };

  let from = null, mon = null;
  let idx = active.findIndex((m) => m && m.id === id);
  if (idx >= 0) { from = "active"; mon = active.splice(idx, 1)[0]; }
  else {
    idx = vault.findIndex((m) => m && m.id === id);
    if (idx < 0) return { ok: false, reason: "not-found" };
    from = "vault"; mon = vault.splice(idx, 1)[0];
  }
  // Keep ≥1 active: a release that emptied the team promotes a vault monster.
  if (active.length === 0 && vault.length > 0) active.push(vault.shift());

  const level = Math.max(1, mon.level || 1);
  const reward = { gold: defeatGold(profile, level), essence: defeatEssence(profile) };
  profile.gold = (profile.gold || 0) + reward.gold;
  profile.essence = (profile.essence || 0) + reward.essence;
  return { ok: true, reward, from, monster: mon };
}

/**
 * Equip a spirit chain the player owns. Validates the id is in the player's chain
 * inventory before setting `equippedChainId` — the same ownership gate the MP
 * `setEquippedChain` handler needs against an untrusted client, and a harmless
 * no-op guard in the (UI-gated) SP path. Mutates `profile`. (PT2-T11 PARITY-3.)
 * @param {{chains?:Array, equippedChainId?:string}} profile
 * @param {string} chainId
 * @returns {boolean} true if equipped (owned), false if the id isn't owned.
 */
export function equipChain(profile, chainId) {
  const id = String(chainId || "");
  if (!(profile.chains || []).some((c) => c.chainId === id)) return false;
  profile.equippedChainId = id;
  return true;
}

/**
 * The next equipped-chain id when cycling owned chains by `dir` (+1 / -1) from
 * `currentId` (the `[` / `]` keys). Wraps around; returns `null` when there's ≤1
 * chain (nothing to cycle). Pure — callers apply it their own way (SP saves to the
 * character; MP sets optimistically + tells the server). PT2-T11 PARITY-3 — was
 * duplicated in SP `game.js` and MP `onlineGame.js`.
 * @param {Array<{chainId:string}>} chains
 * @param {string} currentId
 * @param {number} dir  +1 (next) or -1 (previous)
 * @returns {string|null}
 */
export function nextChainId(chains, currentId, dir) {
  const list = chains || [];
  if (list.length <= 1) return null;
  let idx = list.findIndex((c) => c.chainId === currentId);
  if (idx < 0) idx = 0;
  idx = (idx + dir + list.length) % list.length;
  return list[idx].chainId;
}
