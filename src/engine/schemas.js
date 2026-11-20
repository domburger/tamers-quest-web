export const GAME = Object.freeze({
  TEAM_SIZE: 4,
  VAULT_SIZE: 100,
  ITEM_BAG_SIZE: 12,
  CATCH_HEAL_FRACTION: 0.5,
  MAX_PLAYERS: 16,
  ROUND_DURATION_S: 600,
  CIRCLE_START_S: 300,
  PORTAL_INTERVAL_S: 30,
  XP_PER_LEVEL: 100,
  XP_BASE: 100,
  XP_GROWTH: 1.15,
  SPAWN_LEVEL_MIN: 1,
  SPAWN_LEVEL_MAX: 5,
  TILE_SIZE: 128,
  TILE_OVERLAP: 48,
  EFFECTIVE_TILE: 80, // Tile-to-world px factor (not TILE_SIZE): TILE_SIZE - TILE_OVERLAP.
  PLAYER_RADIUS: 13,
  BASE_SPEED: 200,
  STORM_DPS: 25,
  ENERGY_RESTORE_PCT: 50,
  HIDDEN_MONSTER_PCT: 35,
  REVEAL_RADIUS: 220,
  CANONICAL_STATUSES: ["Burn", "Poison", "Freeze", "Stun"],
  SPIRIT_CHAIN: Object.freeze({
    HIT_RADIUS: 36,
    MULTI_CHAIN_RADIUS: 120,
    MULTI_MAX_TARGETS: 3,
    PROJECTILE_TTL_S: 2.5,
    CHARGE_TIME_S: 0.9,
    CHARGE_RANGE_BONUS: 0.6,
    CHARGE_SPEED_BONUS: 0.35,
    STARTER_CHAIN_ID: "tier1",
    STARTER_CHAIN_IDS: ["tier1", "tier2", "tier3"],
    CHAIN_SLOTS: 3,
    CHESTS_PER_RUN: 16,
    PICKUP_RADIUS: 40,
    CHEST_MINIMAP_RADIUS: 560,
  }),
  SPRINT: Object.freeze({
    MULT: 1.6,
    STAMINA_MAX: 100,
    DRAIN_PER_S: 26,
    REGEN_PER_S: 28,
    MIN_TO_START: 16,
  }),
  GOLD: Object.freeze({
    PER_DEFEAT_BASE: 4,
    PER_DEFEAT_PER_LEVEL: 2,
    PER_EXTRACT: 30,
  }),
  PLAYER_XP: Object.freeze({
    PER_DEFEAT_BASE: 2,
    PER_DEFEAT_PER_LEVEL: 1,
    PER_EXTRACT: 25,
  }),
  BATTLE_PASS: Object.freeze({
    XP_PER_DEFEAT_BASE: 5,
    XP_PER_DEFEAT_PER_LEVEL: 2,
    XP_PER_EXTRACT: 40,
  }),
  CRAFT: Object.freeze({
    UPGRADE_COST_PER_TIER: 40,
  }),
  PREMIUM: Object.freeze({
    MAX: 1e7,
  }),
});

export function createMonsterInstance({ typeName, name, level, stats, id, tileX, tileY }) {
  const m = {
    id,
    typeName,
    name: name ?? typeName,
    level,
    xp: 0,
    currentHealth: stats.health,
    currentEnergy: stats.energy,
    status: null,
  };
  if (tileX !== undefined) m.tileX = tileX;
  if (tileY !== undefined) m.tileY = tileY;
  return m;
}

export function createPlayerProfile({ id, name, isGuest = false }) {
  return {
    id, name, isGuest: !!isGuest, level: 1, xp: 0, gold: 0, essence: 0,
    essencePremium: true,

    activeMonsters: [], vaultMonsters: [], items: [], stats: {},
    chains: [], equippedChainId: null, equippedChainIds: [],
    upgrades: {},
    ownedCosmetics: { chain: [], char: [] },
    bpSeasonId: null, bpXp: 0, bpClaimed: [],
    adFree: false,
    subscribedUntil: 0, // epoch ms; 0 = none
  };
}

export function createChainInstance(chainId, def) {
  return { chainId, throwCount: def.throwCount, durability: def.durability };
}

export function ensureChainSlots(profile) {
  const max = GAME.SPIRIT_CHAIN.CHAIN_SLOTS;
  const owned = new Set((profile.chains || []).map((c) => c.chainId));
  const seen = new Set();
  const slots = [];
  for (const id of Array.isArray(profile.equippedChainIds) ? profile.equippedChainIds : []) {
    if (slots.length >= max) break;
    if (owned.has(id) && !seen.has(id)) { seen.add(id); slots.push(id); }
  }
  for (const id of [profile.equippedChainId, ...(profile.chains || []).map((c) => c.chainId)]) {
    if (slots.length >= max) break;
    if (id && owned.has(id) && !seen.has(id)) { seen.add(id); slots.push(id); }
  }
  profile.equippedChainIds = slots;
  if (!slots.includes(profile.equippedChainId)) profile.equippedChainId = slots[0] || null;
  return profile;
}

export function grantChain(profile, chainId, def, runFound = false) {
  if (!Array.isArray(profile.chains)) profile.chains = [];
  const existing = profile.chains.find((c) => c.chainId === chainId);
  if (existing) {
    existing.throwCount = def.throwCount;
    existing.durability = def.durability;
    // Bank grants clear runFound so a paid refill is never lost on death.
    if (!runFound) delete existing.runFound;
  } else {
    const inst = createChainInstance(chainId, def);
    if (runFound) inst.runFound = true;
    profile.chains.push(inst);
  }
  if (!profile.equippedChainId) profile.equippedChainId = chainId;
  ensureChainSlots(profile);
  return profile;
}

export function goldForDefeat(level) {
  return GAME.GOLD.PER_DEFEAT_BASE + GAME.GOLD.PER_DEFEAT_PER_LEVEL * (level || 1);
}

// Call only from a verified payment webhook, never with client data.
export function grantEssence(profile, amount) {
  const add = Math.max(0, Math.round(Number(amount) || 0));
  profile.essence = Math.min(GAME.PREMIUM.MAX, (profile.essence || 0) + add);
  return profile;
}

export function grantAdFree(profile) {
  if (profile) profile.adFree = true;
  return profile;
}

export function isAdFree(profile, now = Date.now()) {
  return !!(profile && (profile.adFree === true || subscriptionActive(profile, now)));
}

export function subscriptionActive(profile, now = Date.now()) {
  if (!profile) return false;
  if (profile.subscribed === true) return true;
  return (Number(profile.subscribedUntil) || 0) > (Number(now) || 0);
}

// Keeps the latest period end (out-of-order webhooks).
export function grantSubscription(profile, untilMs) {
  if (profile) profile.subscribedUntil = Math.max(Number(profile.subscribedUntil) || 0, Number(untilMs) || 0);
  return profile;
}

export function clearSubscription(profile) {
  if (profile) { profile.subscribedUntil = 0; profile.subscribed = false; }
  return profile;
}

export function upgradeTargetFor(fromDef, defs) {
  if (!fromDef || fromDef.special || typeof fromDef.tier !== "number") return null;
  return (defs || []).find((d) => d.tier === fromDef.tier + 1 && !d.special) || null;
}

export function upgradeCost(fromTier) {
  return GAME.CRAFT.UPGRADE_COST_PER_TIER * (fromTier || 1);
}

export function craftUpgrade(profile, fromId, defs) {
  const fromDef = (defs || []).find((d) => d.id === fromId);
  const toDef = upgradeTargetFor(fromDef, defs);
  if (!toDef) return { ok: false, reason: "maxed" };
  const cs = (profile.chains || []).find((c) => c.chainId === fromId);
  if (!cs) return { ok: false, reason: "owned" };
  const cost = upgradeCost(fromDef.tier);
  if ((profile.gold || 0) < cost) return { ok: false, reason: "gold" };
  profile.gold -= cost;
  profile.chains.splice(profile.chains.indexOf(cs), 1);
  if (profile.equippedChainId === fromId && !profile.chains.some((c) => c.chainId === fromId)) {
    profile.equippedChainId = null;
  }
  grantChain(profile, toDef.id, toDef, false);
  return { ok: true, toId: toDef.id };
}

export function buyChain(profile, def) {
  if (!def || typeof def.price !== "number") return false;
  if ((profile.gold || 0) < def.price) return false;
  profile.gold -= def.price;
  grantChain(profile, def.id, def, false);
  return true;
}

export function finalizeRunChains(profile, kept, getChain) {
  if (!Array.isArray(profile.chains)) profile.chains = [];
  if (kept) {
    for (const c of profile.chains) delete c.runFound;
  } else {
    profile.chains = profile.chains.filter((c) => !c.runFound);
    if (!profile.chains.some((c) => c.chainId === profile.equippedChainId)) {
      profile.equippedChainId = profile.chains[0]?.chainId || null;
    }
    grantStarterChains(profile, getChain);
  }
  ensureChainSlots(profile);
  return profile;
}

export function grantStarterChains(profile, getChain) {
  if (!Array.isArray(profile.chains)) profile.chains = [];
  if (profile.chains.length === 0) {
    const id = GAME.SPIRIT_CHAIN.STARTER_CHAIN_ID;
    const def = (getChain && getChain(id)) || { throwCount: 3, durability: 1 };
    profile.chains.push(createChainInstance(id, def));
  }
  if (!profile.equippedChainId) profile.equippedChainId = profile.chains[0].chainId;
  ensureChainSlots(profile);
  return profile;
}

// Call only at profile creation; re-granting would undo death losses.
export function grantStarterInventory(profile, getChain) {
  if (!Array.isArray(profile.chains)) profile.chains = [];
  const ids = GAME.SPIRIT_CHAIN.STARTER_CHAIN_IDS?.length
    ? GAME.SPIRIT_CHAIN.STARTER_CHAIN_IDS
    : [GAME.SPIRIT_CHAIN.STARTER_CHAIN_ID];
  for (const id of ids) {
    if (profile.chains.some((c) => c.chainId === id)) continue;
    const def = (getChain && getChain(id)) || { throwCount: 3, durability: 1 };
    profile.chains.push(createChainInstance(id, def));
  }
  if (!profile.equippedChainId && profile.chains.length) profile.equippedChainId = profile.chains[0].chainId;
  ensureChainSlots(profile);
  return profile;
}

