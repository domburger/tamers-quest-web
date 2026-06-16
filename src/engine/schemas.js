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
  ITEM_BAG_SIZE: 12, // max combat items a profile can stockpile (world.js chest-loot cap; surfaced in the wiki)
  // CB-9: a freshly-caught monster is stabilized to this fraction of its max HP/energy
  // instead of joining at its near-death combat HP (a 3/300 catch was useless mid-run).
  // 0.5 = usable but not a free full heal (you weakened it to catch it). Tunable.
  CATCH_HEAL_FRACTION: 0.5,
  MAX_PLAYERS: 16,
  ROUND_DURATION_S: 600, // 10 minutes
  CIRCLE_START_S: 300, // safe zone starts shrinking at 5 min
  PORTAL_INTERVAL_S: 30, // a portal every 30s after CIRCLE_START_S
  XP_PER_LEVEL: 100, // DEPRECATED flat threshold — kept only as the level-1 base (== XP_BASE). Use xpForLevel(level).
  // Fixed EXPONENTIAL XP curve (monster-gen spec): the XP to advance FROM `level` to
  // level+1 is XP_BASE * XP_GROWTH^(level-1) — every monster uses the same curve, so
  // higher levels take progressively longer. See progression.js xpForLevel().
  XP_BASE: 100,
  XP_GROWTH: 1.15,
  SPAWN_LEVEL_MIN: 1,
  SPAWN_LEVEL_MAX: 5,
  // World geometry (shared so client + server agree on tile→world conversion).
  TILE_SIZE: 128,
  TILE_OVERLAP: 48,
  EFFECTIVE_TILE: 80, // TILE_SIZE - TILE_OVERLAP; tileCoord * this = world px
  PLAYER_RADIUS: 13, // collision radius (px) ≈ the rendered body half-width
                     // (render/character.js cloak/shadow radiusX 13). Collision
                     // checks the leading body EDGE, not the center, so the
                     // collider matches what you see (PT2-T06).
  BASE_SPEED: 200, // player px/s
  STORM_DPS: 25, // active-monster HP lost per second outside the shrinking safe zone
                 // (shared by the server + SP so the zone has identical stakes)
  ENERGY_RESTORE_PCT: 50, // Q8: % of max energy restored to each team monster at the
                          // start of every encounter, so a depleted team isn't stuck
                          // skipping turns. Shared default for server + SP.
  HIDDEN_MONSTER_PCT: 35, // Q2: ~% of wild monsters that start hidden (ambush) — only
                          // appear within REVEAL_RADIUS. Shared default (server + SP).
  REVEAL_RADIUS: 220, // px within which a hidden monster reveals itself
  CANONICAL_STATUSES: ["Burn", "Poison", "Freeze", "Stun"],
  // Spirit Chain mechanic tunables (definitions live in spiritchains.json).
  SPIRIT_CHAIN: Object.freeze({
    HIT_RADIUS: 36, // world-px radius of the in-flight chain head vs a target
    MULTI_CHAIN_RADIUS: 120, // multi/area chain links targets within this world-px radius
    MULTI_MAX_TARGETS: 3, // max monsters a multi/area throw pulls into one encounter
    PROJECTILE_TTL_S: 2.5, // safety cap so a projectile is always cleaned up (scaled up for a charged throw so the longer arc still returns)
    // TQ-450: charge-up throw — hold the throw key/button to wind up; a longer hold flings the chain
    // farther + faster (the held chain also visibly spins faster while charging). A quick tap = charge 0 =
    // the original throw (purely additive, no nerf). charge ∈ [0,1]; shared so client+server agree.
    CHARGE_TIME_S: 0.9, // hold this long (s) for a full charge
    CHARGE_RANGE_BONUS: 0.6, // full charge → +60% throw range
    CHARGE_SPEED_BONUS: 0.35, // full charge → +35% projectile speed (so the longer throw doesn't feel sluggish)
    STARTER_CHAIN_ID: "tier1", // the default equipped chain + chainless-safety fallback
    STARTER_CHAIN_IDS: ["tier1", "tier2", "tier3", "tier4", "tier5"], // starter inventory: ≥5 chains (user 2026-06-06)
    CHAIN_SLOTS: 3, // equipped-chain loadout: bring up to 3 chains into a run, hot-swap between them (user 2026-06-10)
    CHESTS_PER_RUN: 16, // loot chests spawned against walls each round (raised 10→16: more chests to find per run)
    PICKUP_RADIUS: 40, // walk this close (world px) to open a chest
    CHEST_MINIMAP_RADIUS: 560, // chests blip on the minimap only within this range (raised 420→560: spot chests from farther)
  }),
  // Sprint / stamina traversal (hold Shift to move faster while stamina lasts).
  // GP-4: the old 32 drain / 18 regen gave a punishing 3.1s burst → 5.6s recharge
  // (~36% uptime) + a low-stamina stutter on the huge map. Now ~3.8s burst, ~3.6s
  // recharge (~52% uptime), and a higher restart floor so you don't resume with a
  // sub-second flicker. All tunable.
  SPRINT: Object.freeze({
    MULT: 1.6, // speed multiplier while sprinting
    STAMINA_MAX: 100,
    DRAIN_PER_S: 26, // stamina spent per second sprinting (was 32 → longer bursts)
    REGEN_PER_S: 28, // stamina recovered per second not sprinting (was 18 → faster recovery)
    MIN_TO_START: 16, // min stamina to (re)start a sprint (was 8 → cleaner resume, less stutter)
  }),
  // Gold economy — the ONLY earned currency (essence is premium/paid). Sources here, sinks in
  // upgrades.js + CRAFT below. Designed/balanced curve (~20–50 runs to max upgrades) is documented
  // in docs/ECONOMY.md (TQ-42, decision TQ-92). Source/sink math is shared SP+MP via progression.js.
  GOLD: Object.freeze({
    PER_DEFEAT_BASE: 4, // gold for defeating a wild monster … (× Prospector 1.0–2.0)
    PER_DEFEAT_PER_LEVEL: 2, // … plus this × the monster's level
    PER_EXTRACT: 30, // bonus for completing a run by extracting (× Prospector; forfeited on a failed run)
  }),
  // Player-account XP (prestige track — TQ-186). Player level is account-wide, earned from PLAY,
  // server-authoritative, and NON-pay-to-win (a prestige number, not power). Levels via the shared
  // xpForLevel curve; a slow climb from small per-defeat XP + an extract bonus. Tunable; documented
  // in docs/ECONOMY.md.
  PLAYER_XP: Object.freeze({
    PER_DEFEAT_BASE: 2, // player XP per wild defeat …
    PER_DEFEAT_PER_LEVEL: 1, // … plus this × the defeated monster's level
    PER_EXTRACT: 25, // bonus player XP for completing a run by extracting
  }),
  // TQ-182: battle-pass XP earned from play (its own track, separate from the account PLAYER_XP). Tunable.
  BATTLE_PASS: Object.freeze({
    XP_PER_DEFEAT_BASE: 5, // BP-XP per wild defeat …
    XP_PER_DEFEAT_PER_LEVEL: 2, // … plus this × the defeated monster's level
    XP_PER_EXTRACT: 40, // BP-XP bonus for completing a run by extracting
  }),
  // Chain upgrades: re-denominated to GOLD (TQ-131/TQ-132 — there is no crafting
  // material; gold is the only earned currency).
  CRAFT: Object.freeze({
    UPGRADE_COST_PER_TIER: 40, // gold to upgrade tier N → N+1 = N × this
  }),
  // Premium currency ("Essence"): the ONLY real-money currency (TQ-24/TQ-132). Bought
  // with real money via Paddle, spent on cosmetics only — NEVER on power (non-pay-to-win
  // is a hard constraint; chain upgrades use gold). Unlike gold, essence is
  // server-authoritative ONLY: it is NOT earned in runs and is NEVER trusted from the
  // client — granting essence requires a verified payment webhook (TQ-68). MAX is a sanity
  // clamp on the persisted balance.
  PREMIUM: Object.freeze({
    MAX: 1e7, // sanity cap on a stored essence balance (matches the gold clamp)
  }),
});

/**
 * Static monster definition (monstertype.json / AI generation). Full field list
 * lives in the data file; the load-bearing ones are documented here.
 * @typedef {Object} MonsterType
 * @property {number} id
 * @property {string} typeName  Unique display name; also the sprite key (slugified).
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
 * @property {number} elementalDiffusion  Damage-spread scalar (× power).
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
 * @property {?string} equippedChainId           The ACTIVE owned chain (throws/captures); one of equippedChainIds.
 * @property {string[]} equippedChainIds         Chain-slot loadout (≤ GAME.SPIRIT_CHAIN.CHAIN_SLOTS); hot-swappable in a run.
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
export function createPlayerProfile({ id, name, isGuest = false }) {
  return {
    id, name, isGuest: !!isGuest, level: 1, xp: 0, gold: 0, essence: 0,
    essencePremium: true, // TQ-132: essence is premium/paid; fresh profiles never carry legacy earned essence

    activeMonsters: [], vaultMonsters: [], items: [], stats: {},
    chains: [], equippedChainId: null, equippedChainIds: [],
    upgrades: {}, // account meta-progression (see engine/upgrades.js)
    ownedCosmetics: { chain: [], char: [] }, // CN-9: bought visual-only skin ids, per type
    bpSeasonId: null, bpXp: 0, bpClaimed: [], // TQ-182: battle-pass season progress (server-authoritative)
    adFree: false, // TQ-174: permanent ad-free entitlement (standalone remove-ads purchase); see isAdFree()
    subscribedUntil: 0, // TQ-267: recurring-subscription entitlement expiry (epoch ms; 0 = none). ACTIVE while now < this; see subscriptionActive()
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
 * Sanitize + backfill a profile's chain-slot loadout (`equippedChainIds`). Drops
 * unowned / duplicate ids, caps at GAME.SPIRIT_CHAIN.CHAIN_SLOTS, then fills any
 * empty slots from the owned chains (preferring the current active id) so a fresh
 * or legacy profile always has a usable loadout. Finally pins `equippedChainId`
 * (the ACTIVE chain) to a slot. Idempotent; mutates and returns the profile.
 * Called after every grant/finalize and on profile load (server) so the loadout
 * can't drift from ownership. @param {PlayerProfile} profile
 */
export function ensureChainSlots(profile) {
  const max = GAME.SPIRIT_CHAIN.CHAIN_SLOTS;
  const owned = new Set((profile.chains || []).map((c) => c.chainId));
  const seen = new Set();
  const slots = [];
  for (const id of Array.isArray(profile.equippedChainIds) ? profile.equippedChainIds : []) {
    if (slots.length >= max) break;
    if (owned.has(id) && !seen.has(id)) { seen.add(id); slots.push(id); }
  }
  // Backfill empty slots: the active chain first, then the rest of the inventory.
  for (const id of [profile.equippedChainId, ...(profile.chains || []).map((c) => c.chainId)]) {
    if (slots.length >= max) break;
    if (id && owned.has(id) && !seen.has(id)) { seen.add(id); slots.push(id); }
  }
  profile.equippedChainIds = slots;
  if (!slots.includes(profile.equippedChainId)) profile.equippedChainId = slots[0] || null;
  return profile;
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
    // A refill of an already-banked chain is NOT at risk on death. Enforce that in
    // code (not just via the shop's idle-only gating): a BANK grant (runFound=false,
    // i.e. shop/craft) on an existing instance clears any provisional runFound flag
    // so a paid-for refill can't be wrongly forfeited on death. A loot grant
    // (runFound=true) of a chain you ALREADY own stays as-is (banked dupes stay
    // banked; a provisional dupe stays provisional until extracted).
    if (!runFound) delete existing.runFound;
  } else {
    const inst = createChainInstance(chainId, def);
    if (runFound) inst.runFound = true; // provisional until extracted
    profile.chains.push(inst);
  }
  if (!profile.equippedChainId) profile.equippedChainId = chainId;
  ensureChainSlots(profile); // a new chain auto-fills any empty loadout slot
  return profile;
}

/** Gold awarded for defeating a wild monster of the given level. */
export function goldForDefeat(level) {
  return GAME.GOLD.PER_DEFEAT_BASE + GAME.GOLD.PER_DEFEAT_PER_LEVEL * (level || 1);
}

/**
 * Credit premium currency (essence) to a profile — call this ONLY from a verified
 * payment webhook (TQ-68), never from client-supplied data. Clamps to PREMIUM.MAX.
 * Mutates and returns the profile; caller persists. @param {PlayerProfile} profile
 */
export function grantEssence(profile, amount) {
  const add = Math.max(0, Math.round(Number(amount) || 0));
  profile.essence = Math.min(GAME.PREMIUM.MAX, (profile.essence || 0) + add);
  return profile;
}

/**
 * Grant the PERMANENT ad-free entitlement to a profile (TQ-174) — call this ONLY from a verified
 * payment webhook (the standalone remove-ads one-time purchase), never from client-supplied data.
 * Idempotent (it's a flag). Mutates and returns the profile; caller persists. @param {PlayerProfile} profile
 */
export function grantAdFree(profile) {
  if (profile) profile.adFree = true;
  return profile;
}

/**
 * Whether a profile is entitled to an ad-free experience (TQ-174): either they bought the standalone
 * remove-ads product (profile.adFree) OR they hold an ACTIVE recurring subscription (TQ-173/267).
 * Single shared check so ad rendering (TQ-26) can't drift between the two entitlement sources. Pure
 * (pass `now` explicitly in tests; defaults to Date.now() at the call boundary).
 * @param {PlayerProfile} profile @param {number} [now] epoch ms @returns {boolean}
 */
export function isAdFree(profile, now = Date.now()) {
  return !!(profile && (profile.adFree === true || subscriptionActive(profile, now)));
}

/**
 * TQ-267: whether a profile holds an ACTIVE recurring subscription (TQ-173). Derived from the expiry the
 * verified Paddle webhook stamps (profile.subscribedUntil = the current period end, epoch ms) — active while
 * now < that. A legacy/perpetual boolean `subscribed === true` is also honored as active so earlier wiring
 * (battlePassPanel / isPremiumEntitled) keeps working. Pure; pass `now` explicitly in tests.
 *
 * This is the lapse policy (TQ-76): on cancel/expiry it simply returns false — premium battle-pass claims
 * lock and ads return — while every already-claimed reward + unlocked item + the standalone adFree flag
 * stays untouched (the entitlement is derived, never revokes earned content).
 * @param {PlayerProfile} profile @param {number} [now] epoch ms @returns {boolean}
 */
export function subscriptionActive(profile, now = Date.now()) {
  if (!profile) return false;
  if (profile.subscribed === true) return true; // legacy/perpetual flag
  return (Number(profile.subscribedUntil) || 0) > (Number(now) || 0);
}

/**
 * TQ-267: grant/extend the recurring subscription to a period-end timestamp (epoch ms) — call ONLY from the
 * verified Paddle subscription webhook (TQ-269), never from client data. Keeps the LATEST period end (so an
 * out-of-order webhook can't shorten an active sub). Mutates and returns the profile; caller persists.
 * @param {PlayerProfile} profile @param {number} untilMs
 */
export function grantSubscription(profile, untilMs) {
  if (profile) profile.subscribedUntil = Math.max(Number(profile.subscribedUntil) || 0, Number(untilMs) || 0);
  return profile;
}

/**
 * TQ-267: clear the recurring subscription (cancel/expiry, TQ-269). Ends ONGOING benefits only — keeps every
 * already-unlocked/claimed reward + the standalone adFree flag (TQ-76 lapse policy). Mutates and returns.
 * @param {PlayerProfile} profile
 */
export function clearSubscription(profile) {
  if (profile) { profile.subscribedUntil = 0; profile.subscribed = false; }
  return profile;
}

/** The base-tier chain a chain upgrades into (tier+1, non-special), or null. */
export function upgradeTargetFor(fromDef, defs) {
  if (!fromDef || fromDef.special || typeof fromDef.tier !== "number") return null;
  return (defs || []).find((d) => d.tier === fromDef.tier + 1 && !d.special) || null;
}

/** Gold cost to upgrade a chain of the given tier to the next. */
export function upgradeCost(fromTier) {
  return GAME.CRAFT.UPGRADE_COST_PER_TIER * (fromTier || 1);
}

/**
 * Craft: upgrade an owned chain to the next tier by spending gold and
 * consuming the lower chain. Returns { ok, toId } on success, or { ok:false,
 * reason } ("gold" | "owned" | "maxed"). Mutates the profile; caller persists.
 * @param {PlayerProfile} profile
 * @param {string} fromId   the chain id to upgrade
 * @param {Array} defs      all chain definitions (spiritchains.json)
 */
export function craftUpgrade(profile, fromId, defs) {
  const fromDef = (defs || []).find((d) => d.id === fromId);
  const toDef = upgradeTargetFor(fromDef, defs);
  if (!toDef) return { ok: false, reason: "maxed" };
  const cs = (profile.chains || []).find((c) => c.chainId === fromId);
  if (!cs) return { ok: false, reason: "owned" };
  const cost = upgradeCost(fromDef.tier);
  if ((profile.gold || 0) < cost) return { ok: false, reason: "gold" };
  profile.gold -= cost;
  // Consume one of the lower chain, then grant the upgraded one (banked).
  profile.chains.splice(profile.chains.indexOf(cs), 1);
  if (profile.equippedChainId === fromId && !profile.chains.some((c) => c.chainId === fromId)) {
    profile.equippedChainId = null; // will re-point via grantChain below
  }
  grantChain(profile, toDef.id, toDef, false);
  return { ok: true, toId: toDef.id };
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
  ensureChainSlots(profile); // drop lost chains from the loadout; backfill from survivors
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
  // Chainless SAFETY (death / backfill): ensure ≥1 chain only — does NOT top up to
  // the 5-chain starter set, so run-found chains lost on death stay lost.
  if (profile.chains.length === 0) {
    const id = GAME.SPIRIT_CHAIN.STARTER_CHAIN_ID;
    const def = (getChain && getChain(id)) || { throwCount: 3, durability: 1 };
    profile.chains.push(createChainInstance(id, def));
  }
  if (!profile.equippedChainId) profile.equippedChainId = profile.chains[0].chainId;
  ensureChainSlots(profile);
  return profile;
}

/**
 * NEW-PLAYER starter inventory: a minimum of 5 spirit chains (the base tiers).
 * Called ONLY at profile creation (not on death/load), so it never re-grants
 * run-found chains forfeited on death. Idempotent. Mutates and returns the profile.
 * @param {PlayerProfile} profile
 * @param {(id:string)=>any} getChain
 */
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
  ensureChainSlots(profile); // seed the 3-slot loadout from the starter chains
  return profile;
}

