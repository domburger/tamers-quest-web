// Canonical data schemas — the shared contract between client, server, and
// persistence. This is a plain-JS project, so "types" are JSDoc @typedefs plus
// small pure factory/validator helpers. Import from here instead of re-describing
// shapes ad hoc, and treat GAME as the single source of truth for tunable rules.
//
// Field status: MonsterType / Attack / MonsterInstance / PlayerProfile describe
// data that exists TODAY. RoundState / Snapshot / InputMsg describe the PLANNED
// multiplayer layer (see docs/IMPLEMENTATION_PLAN.md). Wire format for the
// planned messages is specified separately in docs/PROTOCOL.md (P0-T5).

/** Single source of truth for tunable game rules. */
export const GAME = Object.freeze({
  TEAM_SIZE: 4,
  VAULT_SIZE: 100,
  MAX_PLAYERS: 16,
  ROUND_DURATION_S: 600, // 10 minutes
  CIRCLE_START_S: 300, // safe zone starts shrinking at 5 min
  PORTAL_INTERVAL_S: 30, // a portal every 30s after CIRCLE_START_S
  XP_PER_LEVEL: 100,
  SPAWN_LEVEL_MIN: 1,
  SPAWN_LEVEL_MAX: 5,
  // World geometry (shared so client + server agree on tile→world conversion).
  TILE_SIZE: 128,
  TILE_OVERLAP: 48,
  EFFECTIVE_TILE: 80, // TILE_SIZE - TILE_OVERLAP; tileCoord * this = world px
  BASE_SPEED: 200, // player px/s
  ELEMENTS: ["Fire", "Water", "Nature", "Dark", "Light", "Neutral"],
  CANONICAL_STATUSES: ["Burn", "Poison", "Freeze", "Stun"],
  // Spirit Chain mechanic tunables (definitions live in spiritchains.json).
  SPIRIT_CHAIN: Object.freeze({
    HIT_RADIUS: 36, // world-px radius of the in-flight chain head vs a target
    GUARANTEED_HP_PCT: 0.25, // "guaranteed" special auto-catches at/below this HP fraction
    MULTI_CHAIN_RADIUS: 120, // multi/area chain links targets within this world-px radius
    MULTI_MAX_TARGETS: 3, // max monsters a multi/area throw pulls into one encounter
    PROJECTILE_TTL_S: 2.5, // safety cap so a projectile is always cleaned up
    STARTER_CHAIN_ID: "tier1", // chain every new/migrated profile is granted
    CHESTS_PER_RUN: 10, // loot chests spawned against walls each round
    PICKUP_RADIUS: 40, // walk this close (world px) to open a chest
    CHEST_MINIMAP_RADIUS: 420, // chests blip on the minimap only within this range
  }),
  // Gold economy (earned in runs, spent in the spirit shop).
  GOLD: Object.freeze({
    PER_DEFEAT_BASE: 4, // gold for defeating a wild monster …
    PER_DEFEAT_PER_LEVEL: 2, // … plus this × the monster's level
    PER_EXTRACT: 30, // bonus for completing a run by extracting
  }),
});

/** @typedef {"Fire"|"Water"|"Nature"|"Dark"|"Light"|"Neutral"} Element */

/**
 * Static monster definition (monstertype.json / AI generation). Full field list
 * lives in the data file; the load-bearing ones are documented here.
 * @typedef {Object} MonsterType
 * @property {number} id
 * @property {string} typeName  Unique display name; also the sprite key (slugified).
 * @property {Element} element
 * @property {number} rarity    1..5.
 * @property {number} size      Visual scale hint, drives procedural sprite detail.
 * @property {number} baseHealth @property {number} baseStrength @property {number} baseDefense
 * @property {number} baseSpeed  @property {number} basePower    @property {number} baseEnergy
 * @property {number} baseLuck
 * @property {number} healthScaling1 @property {number} healthScaling2  (one pair per stat: stat(level)=floor(base+s1*level^s2))
 * @property {?string} attack_1 @property {?string} attack_2 @property {?string} attack_3 @property {?string} attack_4  Reference Attack.name.
 * @property {string} description
 * @property {?string} biome
 */

/**
 * Attack definition (attacks.json).
 * @typedef {Object} Attack
 * @property {string} name
 * @property {number} damage              Physical scalar (% of strength).
 * @property {number} accuracy            0..1.
 * @property {number} energyCost
 * @property {number} critChance          0..1.
 * @property {number} critMultiplier
 * @property {Element} elementalType
 * @property {number} elementalDiffusion  Elemental scalar (× power).
 * @property {number} penetration         0..1 (ignores this fraction of defense).
 * @property {number} elementalPenetration 0..1.
 * @property {?string} inflictedStatus    See GAME.CANONICAL_STATUSES (others inert — OPEN Q7).
 * @property {number} statusChance        0..1.
 */

/**
 * A concrete monster the player owns, or one placed on the map.
 * @typedef {Object} MonsterInstance
 * @property {string|number} id
 * @property {string} typeName     → MonsterType.typeName.
 * @property {string} name         Nickname; defaults to typeName.
 * @property {number} level
 * @property {number} xp
 * @property {number} currentHealth
 * @property {number} currentEnergy
 * @property {?string} status
 * @property {number} [tileX]      Map spawn only.
 * @property {number} [tileY]      Map spawn only.
 */

/**
 * Player account/profile (persisted; localStorage today, server DB in P1).
 * @typedef {Object} PlayerProfile
 * @property {string|number} id
 * @property {string} name
 * @property {number} level
 * @property {number} xp
 * @property {number} gold
 * @property {MonsterInstance[]} activeMonsters  ≤ GAME.TEAM_SIZE.
 * @property {MonsterInstance[]} vaultMonsters   ≤ GAME.VAULT_SIZE.
 * @property {ChainInstance[]} chains            Owned spirit chains (live counters).
 * @property {?string} equippedChainId           Which owned chain throws/captures.
 */

/**
 * A spirit chain the player owns. References a definition in spiritchains.json
 * by `chainId`; the depleting counters live on the instance.
 * @typedef {Object} ChainInstance
 * @property {string} chainId      → spiritchains.json id.
 * @property {?number} throwCount  Overworld throws left (null = unlimited / "endless").
 * @property {number} durability   Capture charges left (consumed on successful capture).
 */

/** @typedef {Object} Circle @property {number} centerX @property {number} centerY @property {number} radius @property {number} startAtS */
/** @typedef {Object} Portal @property {string} id @property {number} x @property {number} y */

/**
 * PLANNED multiplayer — authoritative full state of one extraction round.
 * @typedef {Object} RoundState
 * @property {string} roundId
 * @property {number} seed            Map seed; clients regenerate the map from it.
 * @property {number} mapSize
 * @property {number} startedAtMs
 * @property {number} durationS       Defaults to GAME.ROUND_DURATION_S.
 * @property {Circle} circle
 * @property {Portal[]} portals
 * @property {Object.<string, RoundPlayer>} players   Keyed by playerId.
 * @property {Object.<string, RoundMonster>} monsters Keyed by monster id.
 * @property {"lobby"|"active"|"ended"} phase
 */

/**
 * PLANNED — a player inside a round (server-side truth).
 * @typedef {Object} RoundPlayer
 * @property {string} playerId @property {string} name
 * @property {number} x @property {number} y
 * @property {MonsterInstance[]} team
 * @property {boolean} alive @property {boolean} extracted
 */

/**
 * PLANNED — a monster placed in a round. `hidden` monsters are withheld from
 * snapshots until a viewer is close enough (visible/hidden spawns).
 * @typedef {Object} RoundMonster
 * @property {string} id @property {string} typeName @property {number} level
 * @property {number} x @property {number} y @property {boolean} hidden
 */

/**
 * PLANNED — server→client snapshot, area-of-interest filtered per viewer.
 * @typedef {Object} Snapshot
 * @property {number} tick @property {number} timeRemainingS
 * @property {RoundPlayer} you
 * @property {Array.<{id:string,name:string,x:number,y:number}>} players  Others in view.
 * @property {Array.<{id:string,typeName:string,level:number,x:number,y:number}>} monsters  Visible only.
 * @property {Portal[]} portals @property {Circle} circle
 */

/**
 * PLANNED — client→server input. `seq` enables server reconciliation / client
 * prediction. Wire details in docs/PROTOCOL.md.
 * @typedef {Object} InputMsg
 * @property {number} seq
 * @property {"move"|"interact"|"combatAction"} type
 * @property {Object} payload
 */

// ── Pure factories / validators (no data.js / DOM / network deps) ──

/**
 * Build a fresh MonsterInstance at full HP/energy.
 * Stats are passed in (caller computes via getMonsterStats) to keep the engine
 * decoupled from the data layer.
 * @param {{typeName:string, name?:string, level:number, stats:{health:number,energy:number}, id:string|number, tileX?:number, tileY?:number}} o
 * @returns {MonsterInstance}
 */
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

/**
 * Build a fresh player profile.
 * @param {{id:string|number, name:string}} o
 * @returns {PlayerProfile}
 */
export function createPlayerProfile({ id, name }) {
  return {
    id, name, level: 1, xp: 0, gold: 0,
    activeMonsters: [], vaultMonsters: [], stats: {},
    chains: [], equippedChainId: null,
  };
}

/**
 * Build a fresh spirit-chain instance from its definition. `throwCount` may be
 * null (the "endless" special) meaning unlimited overworld throws.
 * @param {string} chainId
 * @param {{throwCount:?number, durability:number}} def  spiritchains.json entry.
 * @returns {ChainInstance}
 */
export function createChainInstance(chainId, def) {
  return { chainId, throwCount: def.throwCount, durability: def.durability };
}

/**
 * Grant a chain to a profile (loot pickup / shop / craft). If the profile
 * already owns that chain id, top its counters back up to the definition's
 * maxima (a duplicate refills throws + charges) rather than stacking instances;
 * otherwise add a fresh instance. Auto-equips it if nothing is equipped.
 * Mutates and returns the profile. Caller persists.
 * @param {PlayerProfile} profile
 * @param {string} chainId
 * @param {{throwCount:?number, durability:number}} def  spiritchains.json entry.
 * @returns {PlayerProfile}
 */
export function grantChain(profile, chainId, def, runFound = false) {
  if (!Array.isArray(profile.chains)) profile.chains = [];
  const existing = profile.chains.find((c) => c.chainId === chainId);
  if (existing) {
    existing.throwCount = def.throwCount; // null stays null (endless)
    existing.durability = def.durability;
    // A refill of an already-banked chain is NOT at risk on death.
  } else {
    const inst = createChainInstance(chainId, def);
    if (runFound) inst.runFound = true; // provisional until extracted
    profile.chains.push(inst);
  }
  if (!profile.equippedChainId) profile.equippedChainId = chainId;
  return profile;
}

/** Gold awarded for defeating a wild monster of the given level. */
export function goldForDefeat(level) {
  return GAME.GOLD.PER_DEFEAT_BASE + GAME.GOLD.PER_DEFEAT_PER_LEVEL * (level || 1);
}

/**
 * Buy a chain from the shop. Deducts `def.price` gold and grants the chain
 * (banked, NOT run-found) if affordable. Returns true on success, false if too
 * poor. Mutates the profile; caller persists.
 * @param {PlayerProfile} profile
 * @param {{id?:string, price?:number, throwCount:?number, durability:number}} def
 * @returns {boolean}
 */
export function buyChain(profile, def) {
  if (!def || typeof def.price !== "number") return false;
  if ((profile.gold || 0) < def.price) return false;
  profile.gold -= def.price;
  grantChain(profile, def.id, def, false); // purchased chains are permanent
  return true;
}

/**
 * Resolve the extraction stakes on a profile's chains at run end.
 * - kept=true (extracted): run-found chains become permanent (clear the flag).
 * - kept=false (death/timeout): run-found chains are LOST; banked chains stay.
 * Re-points the equipped id if it was dropped, and ensures a usable starter
 * remains. Mutates and returns the profile. `getChain` resolves a def by id.
 * @param {PlayerProfile} profile
 * @param {boolean} kept
 * @param {(id:string)=>any} getChain
 * @returns {PlayerProfile}
 */
export function finalizeRunChains(profile, kept, getChain) {
  if (!Array.isArray(profile.chains)) profile.chains = [];
  if (kept) {
    for (const c of profile.chains) delete c.runFound;
  } else {
    profile.chains = profile.chains.filter((c) => !c.runFound);
    if (!profile.chains.some((c) => c.chainId === profile.equippedChainId)) {
      profile.equippedChainId = profile.chains[0]?.chainId || null;
    }
    grantStarterChains(profile, getChain); // never leave a player chainless
  }
  return profile;
}

/**
 * Ensure a profile owns at least the starter chain (idempotent). Used both for
 * brand-new profiles and for backfilling saves that predate the chains field.
 * Mutates and returns the profile. `getChain` resolves a definition by id; if it
 * returns nothing (data not loaded), a hardcoded starter fallback is used so the
 * grant never depends on load order.
 * @param {PlayerProfile} profile
 * @param {(id:string)=>({throwCount:?number,durability:number}|undefined)} getChain
 * @returns {PlayerProfile}
 */
export function grantStarterChains(profile, getChain) {
  if (!Array.isArray(profile.chains)) profile.chains = [];
  if (profile.chains.length === 0) {
    const id = GAME.SPIRIT_CHAIN.STARTER_CHAIN_ID;
    const def = (getChain && getChain(id)) || { throwCount: 3, durability: 1 };
    profile.chains.push(createChainInstance(id, def));
  }
  if (!profile.equippedChainId) profile.equippedChainId = profile.chains[0].chainId;
  return profile;
}

/** @param {any} v @returns {v is Element} */
export function isElement(v) {
  return GAME.ELEMENTS.includes(v);
}

/** Shallow structural check for a MonsterInstance. @returns {boolean} */
export function isValidMonsterInstance(m) {
  return !!m && typeof m.typeName === "string" && typeof m.level === "number" &&
    typeof m.currentHealth === "number" && typeof m.currentEnergy === "number";
}

/**
 * Enforce roster size limits, overflowing the active team into the vault.
 * Mutates and returns the profile.
 * @param {PlayerProfile} profile
 * @returns {PlayerProfile}
 */
export function clampRoster(profile) {
  profile.activeMonsters = profile.activeMonsters || [];
  profile.vaultMonsters = profile.vaultMonsters || [];
  if (profile.activeMonsters.length > GAME.TEAM_SIZE) {
    const overflow = profile.activeMonsters.splice(GAME.TEAM_SIZE);
    profile.vaultMonsters.push(...overflow);
  }
  if (profile.vaultMonsters.length > GAME.VAULT_SIZE) {
    profile.vaultMonsters.length = GAME.VAULT_SIZE;
  }
  return profile;
}
