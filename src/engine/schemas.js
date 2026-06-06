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
  ELEMENTS: ["Fire", "Water", "Nature", "Dark", "Light", "Neutral"],
  CANONICAL_STATUSES: ["Burn", "Poison", "Freeze", "Stun"],
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
  return { id, name, level: 1, xp: 0, gold: 0, activeMonsters: [], vaultMonsters: [] };
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
