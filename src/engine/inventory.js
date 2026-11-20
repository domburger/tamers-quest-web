import { GAME, ensureChainSlots } from "./schemas.js";
import { vaultCapacity } from "./upgrades.js";
import { defeatGold } from "./progression.js";

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
  if (active.length === 0 && vault.length > 0) active.push(vault.shift());

  const level = Math.max(1, mon.level || 1);
  const reward = { gold: defeatGold(profile, level) };
  profile.gold = (profile.gold || 0) + reward.gold;
  return { ok: true, reward, from, monster: mon };
}

export function loseRunTeam(profile, rollStarters) {
  profile.vaultMonsters = profile.vaultMonsters || [];
  profile.activeMonsters = profile.vaultMonsters.splice(0, GAME.TEAM_SIZE);
  if (profile.activeMonsters.length === 0 && typeof rollStarters === "function") {
    profile.activeMonsters = rollStarters() || [];
  }
  return profile.activeMonsters;
}

// Ownership check guards untrusted MP clients; do not drop it.
export function equipChain(profile, chainId) {
  const id = String(chainId || "");
  if (!(profile.chains || []).some((c) => c.chainId === id)) return false;
  if (!Array.isArray(profile.equippedChainIds)) profile.equippedChainIds = [];
  if (!profile.equippedChainIds.includes(id)) {
    if (profile.equippedChainIds.length < GAME.SPIRIT_CHAIN.CHAIN_SLOTS) profile.equippedChainIds.push(id);
    else profile.equippedChainIds[profile.equippedChainIds.length - 1] = id;
  }
  profile.equippedChainId = id;
  return true;
}

export function setChainSlots(profile, ids) {
  if (!profile) return false;
  const owned = new Set((profile.chains || []).map((c) => c.chainId));
  const seen = new Set();
  const slots = [];
  for (const raw of Array.isArray(ids) ? ids : []) {
    if (slots.length >= GAME.SPIRIT_CHAIN.CHAIN_SLOTS) break;
    const id = String(raw || "");
    if (owned.has(id) && !seen.has(id)) { seen.add(id); slots.push(id); }
  }
  profile.equippedChainIds = slots;
  if (!slots.includes(profile.equippedChainId)) profile.equippedChainId = slots[0] || null;
  if (slots.length === 0 && (profile.chains || []).length) ensureChainSlots(profile);
  return true;
}

export function nextChainId(chains, currentId, dir) {
  const list = chains || [];
  if (list.length <= 1) return null;
  let idx = list.findIndex((c) => c.chainId === currentId);
  if (idx < 0) idx = 0;
  idx = (idx + dir + list.length) % list.length;
  return list[idx].chainId;
}

