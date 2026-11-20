import { GAME, goldForDefeat, subscriptionActive } from "./schemas.js";
import { getMonsterStats } from "./stats.js";
import { getMonsterType } from "./gamedata.js";
import { goldMult } from "./upgrades.js";
import { SEASON, isTierReached, rewardAt } from "./battlePass.js";

export function grantXp(inst, amount) {
  inst.xp = (inst.xp || 0) + amount;
  let leveled = false;
  let need = xpForLevel(inst.level);
  while (inst.xp >= need) {
    inst.xp -= need;
    inst.level += 1;
    leveled = true;
    const st = getMonsterStats(getMonsterType(inst.typeName), inst.level);
    inst.currentHealth = st.health;
    inst.currentEnergy = st.energy;
    need = xpForLevel(inst.level);
  }
  return leveled;
}

export function xpForLevel(level) {
  const lvl = Math.max(1, Math.floor(level || 1));
  return Math.round(GAME.XP_BASE * Math.pow(GAME.XP_GROWTH, lvl - 1));
}

export function healToFull(inst) {
  const st = getMonsterStats(getMonsterType(inst.typeName), inst.level);
  inst.currentHealth = st.health;
  inst.currentEnergy = st.energy;
  inst.status = null;
  return inst;
}

export function healTeam(team) {
  for (const m of team || []) healToFull(m);
  return team;
}

export function extractGold(profile) {
  return Math.round(GAME.GOLD.PER_EXTRACT * goldMult(profile));
}

export function grantExtractRewards(profile) {
  const gold = extractGold(profile);
  profile.gold = (profile.gold || 0) + gold;
  grantPlayerXp(profile, GAME.PLAYER_XP.PER_EXTRACT);
  grantBattlePassXp(profile, GAME.BATTLE_PASS.XP_PER_EXTRACT);
  return gold;
}

export function ensureBattlePassSeason(profile) {
  if (!profile) return profile;
  if (profile.bpSeasonId !== SEASON.id) { profile.bpSeasonId = SEASON.id; profile.bpXp = 0; profile.bpClaimed = []; }
  if (!Array.isArray(profile.bpClaimed)) profile.bpClaimed = [];
  if (!Number.isFinite(profile.bpXp)) profile.bpXp = 0;
  return profile;
}

export function battlePassDefeatXp(level) {
  return GAME.BATTLE_PASS.XP_PER_DEFEAT_BASE + GAME.BATTLE_PASS.XP_PER_DEFEAT_PER_LEVEL * (level || 1);
}

export function grantBattlePassXp(profile, amount) {
  ensureBattlePassSeason(profile);
  const add = Math.max(0, Math.round(Number(amount) || 0));
  profile.bpXp = Math.min(99_999_999, (profile.bpXp || 0) + add);
  return profile.bpXp;
}

export function isPremiumEntitled(profile, now = Date.now()) {
  return subscriptionActive(profile, now);
}

export function claimBattlePassTier(profile, tier, track, { entitled = false } = {}) {
  ensureBattlePassSeason(profile);
  const t = Math.floor(Number(tier) || 0);
  const trk = track === "premium" ? "premium" : "free";
  if (!isTierReached(t, profile.bpXp)) return { ok: false, reason: "locked-tier" };
  if (trk === "premium" && !entitled) return { ok: false, reason: "no-entitlement" };
  const reward = rewardAt(t, trk);
  if (!reward) return { ok: false, reason: "no-reward" };
  const key = `${trk}:${t}`;
  if (profile.bpClaimed.includes(key)) return { ok: false, reason: "claimed" };
  profile.bpClaimed.push(key);
  return { ok: true, reward, key };
}

export function playerDefeatXp(level) {
  return GAME.PLAYER_XP.PER_DEFEAT_BASE + GAME.PLAYER_XP.PER_DEFEAT_PER_LEVEL * (level || 1);
}

export function grantPlayerXp(profile, amount) {
  if (!profile || !(amount > 0)) return false;
  profile.level = Math.max(1, Math.floor(profile.level || 1));
  profile.xp = (profile.xp || 0) + amount;
  let leveled = false;
  let need = xpForLevel(profile.level);
  while (profile.xp >= need) {
    profile.xp -= need;
    profile.level += 1;
    leveled = true;
    need = xpForLevel(profile.level);
  }
  return leveled;
}

export function bumpStat(profile, key, n = 1) {
  if (!profile || !key) return;
  profile.stats = profile.stats || {};
  profile.stats[key] = (profile.stats[key] || 0) + n;
}

export function defeatGold(profile, level) {
  return Math.round(goldForDefeat(level) * goldMult(profile));
}

