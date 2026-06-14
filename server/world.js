// Authoritative world: sessions + lobby/matchmaking + concurrent rounds + tick.
// Imports the shared engine so client and server run identical rules.
// Flow: join (session) → queue → matchmaker forms a round (≤16, fresh seed) →
// roundStart → in-round movement/snapshots. Combat (P3), seeded-map spawns (P2),
// and DB persistence (P1-T2) plug in later behind the existing seams.

import { randomSeed, makeRng, hashString } from "../src/engine/rng.js";
import { GAME, grantChain, finalizeRunChains, buyChain, craftUpgrade, ensureChainSlots, grantEssence } from "../src/engine/schemas.js";
import { generateMap, findSpreadSpawns, isWalkable } from "../src/engine/mapgen.js"; // isWalkable = the SHARED collision rule (also used by SP game.js + MP prediction)
import { getByToken, createProfile, saveProfile, rollStarters, bumpStat, newMonsterId, secureId } from "./store.js";
import { resolveCombatAction, makeEnemy, attacksFor, monSnap, restoreEnergyPartial } from "./combat.js";
import { aiEnabled } from "./ai.js"; // FGT-T1: combat is AI-only — gate engagement on the judge being configured
import { getMonsterType, getSpiritChain, getSpiritChains, getItem, getItems } from "../src/engine/gamedata.js";
import { getMonsterStats, getMonsterMaxHp } from "../src/engine/stats.js";
import { grantExtractRewards, defeatGold, healTeam, grantPlayerXp, playerDefeatXp, grantBattlePassXp, battlePassDefeatXp, claimBattlePassTier, isPremiumEntitled } from "../src/engine/progression.js";
import { canThrow, rollChainDrop, clusterTargets } from "../src/engine/spiritchains.js";
import { purchaseUpgrade, getUpgradeDef, vaultCapacity } from "../src/engine/upgrades.js";
import { addCaughtMonster, applyRoster, equipChain, setChainSlots, releaseMonster, loseRunTeam } from "../src/engine/inventory.js";
import { itemCombatDescription, rollItemFromPool } from "../src/engine/items.js"; // TQ-64/65: structured item effect + rarity-weighted drops
import { buySkin, skinAcquire } from "../src/engine/cosmetics.js"; // CN-9 cosmetic purchase (pure)
// Cosmetic catalogs are import-free pure data (skin id/acquire + render params),
// so the server can read them to validate a purchase price authoritatively.
import { CHAIN_SKINS } from "../src/render/chainCosmetics.js";
import { CHARACTER_SKINS } from "../src/render/characterCosmetics.js";
import { sprintingNow, tickStamina, sprintMult } from "../src/engine/movement.js";
import { generateMonster } from "./content.js";
import { maybeStartPvp, startPvp, handlePvpAction, endPvpFor } from "./pvp.js";

// Area-of-interest radii (world px) for snapshot filtering.
const AOI_RADIUS = 900; // visible monsters within this of a player
const REVEAL_RADIUS = GAME.REVEAL_RADIUS; // hidden monsters only reveal within this (ambush)
const HIDDEN_MONSTER_PCT = GAME.HIDDEN_MONSTER_PCT; // ~this % of monsters start hidden (Q2); shared w/ SP
const ENCOUNTER_RADIUS = 44; // walk within this of a monster to start a fight
const ITEM_DROP_CHANCE = 0.3; // TQ-65: a loot chest holds one (rarity-weighted) AI item this often
const EXTRACT_RADIUS = 48; // step within this of a portal to extract
const STORM_DPS = GAME.STORM_DPS; // (legacy) flat storm HP/s — superseded by the danger meter below
// Zone DANGER meter (user request 2026-06-11): OUTSIDE the closing safe circle a danger bar fills
// to full over DANGER_FILL_S seconds → the run is lost ("zone" death); back in SAFETY it drains to
// empty over DANGER_DRAIN_S seconds (linear). Replaces storm HP-attrition as the zone-death rule.
const DANGER_FILL_S = 30; // seconds in the zone before you die
const DANGER_DRAIN_S = 10; // seconds in safety to clear a full bar
const DISCONNECT_GRACE_MS = 120000; // Q12: keep a dropped in-round player this long to reconnect; else it's a death

export function createWorld({
  countdownTicks = 75,
  minPlayers = 1,
  roundDurationS = GAME.ROUND_DURATION_S,
  circleStartS = GAME.CIRCLE_START_S,
  portalIntervalS = GAME.PORTAL_INTERVAL_S,
  monsterGenRate = 0, // P5: chance per round to generate+add a new AI monster (0 = off)
  pvpEnabled = false, // P3-T5: FFA PvP on collision (off by default)
  // Gameplay knobs — admin-tunable (P7); defaults are the long-standing constants.
  baseSpeed = GAME.BASE_SPEED,
  stormDps = STORM_DPS,
  dangerFillS = DANGER_FILL_S, // zone-death timer: seconds outside the safe zone before you die
  dangerDrainS = DANGER_DRAIN_S, // seconds in safety to drain a full danger bar (linear)
  encounterRadius = ENCOUNTER_RADIUS,
  hiddenMonsterPct = HIDDEN_MONSTER_PCT,
  energyRestorePct = GAME.ENERGY_RESTORE_PCT,
  pvpRadius = 40,
  // Wild-monster approach (slow hunt): a deterministic random SUBSET of monsters slowly walk
  // toward the nearest in-range player until they reach encounterRadius and the fight starts.
  // The rest stay put. Admin-tunable; the client derives the walk animation + facing from the
  // resulting motion (no extra snapshot payload).
  monsterApproachPct = 30, // % of monsters that hunt (0 = none ever move)
  monsterApproachSpeedFrac = 0.35, // approach speed as a fraction of baseSpeed — deliberately slow
  monsterApproachRadius = 700, // a hunter notices + chases a player within this range (else idles)
} = {}) {
  return {
    cfg: {
      countdownTicks, minPlayers, roundDurationS, circleStartS, portalIntervalS, monsterGenRate, pvpEnabled,
      baseSpeed, stormDps, dangerFillS, dangerDrainS, encounterRadius, hiddenMonsterPct, energyRestorePct, pvpRadius,
      monsterApproachPct, monsterApproachSpeedFrac, monsterApproachRadius,
    },
    sessions: new Map(), // playerId -> { profile, ws, state:'idle'|'queued'|'in_round', roundId }
    queue: [], // playerIds awaiting a match, in arrival order
    formingAtTick: null, // tick the next round starts (countdown), or null when queue empty
    rounds: new Map(), // roundId -> { roundId, seed, phase, startedAtMs, players:Map(id->rp) }
    combats: new Map(), // combatId -> { combatId, playerId, roundId, team, activeIdx, enemy, ... }
    pvps: new Map(), // pvpId -> { pvpId, roundId, a, b, resolving } (P3-T5)
    tick: 0,
    nextRound: 1,
    nextCombat: 1,
    nextPvp: 1,
    recentResults: [], // ring buffer of recent run endings (admin live-ops, P7-T4)
  };
}

export function handleMessage(world, conn, msg, send) {
  if (!msg || typeof msg.t !== "string") return;
  switch (msg.t) {
    case "hello":
      send(conn.ws, { t: "server_info", maxPlayers: GAME.MAX_PLAYERS, serverTime: Date.now() });
      break;

    case "join": {
      if (conn.playerId) return; // already authenticated on this connection
      // Resume by session token, or create a new anonymous profile (decision Q6).
      let profile = getByToken(msg.token);
      const wasFresh = !profile; // freshly minted THIS join → safe to one-time migrate into (SP/MP unify)
      if (!profile) profile = createProfile(sanitizeNick(msg.nickname), { isGuest: !!msg.isGuest });
      const existing = world.sessions.get(profile.id);
      if (existing && !existing.disconnected) {
        send(conn.ws, { t: "error", code: "already_connected", message: "Profile already connected." });
        return;
      }
      conn.playerId = profile.id;
      const welcome = { t: "welcome", you: welcomePayload(profile) };

      if (existing && existing.disconnected) {
        // Q12 reconnect within the grace window: re-attach this socket and resume.
        existing.ws = conn.ws;
        existing.disconnected = false;
        existing.disconnectedAt = null;
        send(conn.ws, welcome);
        const round = existing.roundId ? world.rounds.get(existing.roundId) : null;
        const rp = round?.players.get(profile.id);
        if (round && rp) resumeRound(world, existing, round, rp, send);
        else {
          // Round ended during the grace window. Deliver the terminal result (died/extracted)
          // that endRunForPlayer stashed when it couldn't reach the dead socket, so the client
          // shows its result card and exits the round instead of freezing on a dead view.
          existing.state = "idle"; existing.roundId = null;
          if (existing.pendingResult) { send(conn.ws, existing.pendingResult); existing.pendingResult = null; }
        }
        return;
      }

      world.sessions.set(profile.id, { profile, ws: conn.ws, state: "idle", roundId: null, fresh: wasFresh });
      send(conn.ws, welcome);
      break;
    }

    // SP/MP unify migration (user decision: the server profile is the single source of truth).
    case "queue": {
      const s = world.sessions.get(conn.playerId);
      if (!s || s.state !== "idle") return;
      s.state = "queued";
      world.queue.push(conn.playerId);
      if (world.formingAtTick === null) world.formingAtTick = world.tick + world.cfg.countdownTicks;
      send(conn.ws, { t: "queued", position: world.queue.length });
      break;
    }

    // Single-player (SP/MP unify): form a PRIVATE 1-player round IMMEDIATELY — no matchmaking
    // wait, and no chance of another player joining. It's the same server-authoritative round as
    // MP, so SP catches/loot/xp are server-resolved (cheat-proof) and persist to the one profile.
    case "queueSolo": {
      const s = world.sessions.get(conn.playerId);
      if (!s || s.state !== "idle") return;
      formRound(world, [conn.playerId], send);
      break;
    }

    case "unqueue": {
      const s = world.sessions.get(conn.playerId);
      if (!s || s.state !== "queued") return;
      s.state = "idle";
      world.queue = world.queue.filter((id) => id !== conn.playerId);
      if (world.queue.length === 0) world.formingAtTick = null;
      send(conn.ws, { t: "unqueued" });
      break;
    }

    case "input": {
      const s = world.sessions.get(conn.playerId);
      if (!s || s.state !== "in_round") return;
      const rp = world.rounds.get(s.roundId)?.players.get(conn.playerId);
      if (!rp) return;
      if (typeof msg.seq === "number") rp.lastSeq = msg.seq;
      if (msg.type === "move" && msg.payload) {
        rp.pendingMove = { dx: clampAxis(msg.payload.dx), dy: clampAxis(msg.payload.dy), sprint: !!msg.payload.sprint };
      } else if (msg.type === "throw" && msg.payload) {
        // Queue a spirit-chain throw; validated against authoritative state at tick.
        rp.pendingThrow = {
          dx: clampAxis(msg.payload.dx),
          dy: clampAxis(msg.payload.dy),
          chainId: String(msg.payload.chainId || ""),
        };
      }
      break;
    }

    case "setEquippedChain": {
      const s = world.sessions.get(conn.playerId);
      if (!s) return;
      // PT2-T11 PARITY-3: shared owned-gate + set (engine/inventory.js). Hot-swaps the
      // ACTIVE chain among the loadout slots (or slots an owned chain) in a run.
      if (equipChain(s.profile, msg.chainId)) saveProfile(s.profile);
      break;
    }

    case "setChainSlots": {
      // The inventory's 3-slot chain loadout (user 2026-06-10). Untrusted id list →
      // the shared engine validates ownership / dedupes / caps at CHAIN_SLOTS.
      const s = world.sessions.get(conn.playerId);
      if (!s) return;
      if (setChainSlots(s.profile, msg.chainIds)) saveProfile(s.profile);
      break;
    }

    case "setSkin": {
      // CN-12: a player's equipped (visual-only) chain-skin id, broadcast in snapshots
      // so rivals see it. Untrusted string → validate as a short token (the client's
      // renderer falls back to a default for unknown ids); length-capped vs abuse.
      const s = world.sessions.get(conn.playerId);
      if (!s) return;
      const id = String(msg.skinId || "");
      if (id && /^[a-z0-9_-]{1,24}$/i.test(id)) {
        s.profile.equippedSkinId = id;
        saveProfile(s.profile);
      }
      break;
    }

    case "setCharSkin": {
      // A player's equipped character body-model skin id, broadcast in snapshots so
      // rivals render the right figure (knight/mage/automaton/wisp/cloak). Same
      // untrusted-token validation as setSkin (the client renderer falls back to the
      // default "cloak" model for unknown ids); length-capped vs abuse.
      const s = world.sessions.get(conn.playerId);
      if (!s) return;
      const id = String(msg.charId || "");
      if (id && /^[a-z0-9_-]{1,24}$/i.test(id)) {
        s.profile.equippedCharId = id;
        saveProfile(s.profile);
      }
      break;
    }

    case "buyChain": {
      const s = world.sessions.get(conn.playerId);
      if (!s) return;
      if (s.state !== "idle") { // shop only between runs
        send(conn.ws, { t: "shop", ok: false, locked: true, gold: s.profile.gold || 0, essence: s.profile.essence || 0, chains: s.profile.chains || [], equippedChainId: s.profile.equippedChainId || null, equippedChainIds: s.profile.equippedChainIds || [] });
        return;
      }
      const def = getSpiritChain(String(msg.chainId || ""));
      const ok = buyChain(s.profile, def);
      if (ok) saveProfile(s.profile);
      send(conn.ws, { t: "shop", ok, gold: s.profile.gold || 0, essence: s.profile.essence || 0, chains: s.profile.chains || [], equippedChainId: s.profile.equippedChainId || null, equippedChainIds: s.profile.equippedChainIds || [] });
      break;
    }

    case "craftChain": {
      const s = world.sessions.get(conn.playerId);
      if (!s) return;
      if (s.state !== "idle") { // crafting only between runs
        send(conn.ws, { t: "shop", ok: false, locked: true, gold: s.profile.gold || 0, essence: s.profile.essence || 0, chains: s.profile.chains || [], equippedChainId: s.profile.equippedChainId || null, equippedChainIds: s.profile.equippedChainIds || [] });
        return;
      }
      const r = craftUpgrade(s.profile, String(msg.chainId || ""), getSpiritChains());
      if (r.ok) saveProfile(s.profile);
      send(conn.ws, { t: "shop", ok: r.ok, reason: r.reason, gold: s.profile.gold || 0, essence: s.profile.essence || 0, chains: s.profile.chains || [], equippedChainId: s.profile.equippedChainId || null, equippedChainIds: s.profile.equippedChainIds || [] });
      break;
    }

    case "buyCosmetic": {
      // CN-9: server-authoritative cosmetic purchase (the MP twin of the SP-only
      // client buy). Visual-only skins; the price/affordability is validated here
      // against the server-safe catalog so a client can't forge a cheaper buy.
      const s = world.sessions.get(conn.playerId);
      if (!s) return;
      const prof = s.profile;
      prof.ownedCosmetics = prof.ownedCosmetics || { chain: [], char: [] };
      const kind = msg.kind === "char" ? "char" : "chain";
      const catalog = kind === "chain" ? CHAIN_SKINS : CHARACTER_SKINS;
      const skin = catalog.find((sk) => sk.id === String(msg.skinId || ""));
      // Cosmetics are priced in gold (earned) or essence (premium/paid). Both balances are
      // server-authoritative, so we run buySkin against the STORED profile (never client wallet
      // math) — this is the only spend path for either currency. TQ-132.
      const r = buySkin(skin, { gold: prof.gold || 0, essence: prof.essence || 0 }, prof.ownedCosmetics[kind] || []);
      if (r.ok) {
        prof.gold = r.gold; prof.essence = r.essence;
        prof.ownedCosmetics[kind] = r.owned;
        saveProfile(prof);
      }
      send(conn.ws, { t: "cosmetic", ok: r.ok, reason: r.reason, kind, gold: prof.gold || 0, essence: prof.essence || 0, ownedCosmetics: prof.ownedCosmetics });
      break;
    }

    case "claimBpTier": {
      // TQ-183: server-authoritative + idempotent battle-pass tier claim. Free track claims on any
      // reached tier; the premium track requires the subscription entitlement (TQ-173). The pure
      // claimBattlePassTier validates + records the claim; we apply the returned reward via the
      // existing grant systems (non-pay-to-win: gold / essence / cosmetic / chain only).
      const s = world.sessions.get(conn.playerId);
      if (!s) return;
      const prof = s.profile;
      const r = claimBattlePassTier(prof, msg.tier, msg.track, { entitled: isPremiumEntitled(prof) });
      if (r.ok) {
        const rw = r.reward;
        if (rw.kind === "gold") prof.gold = (prof.gold || 0) + (rw.amount || 0);
        else if (rw.kind === "essence") grantEssence(prof, rw.amount || 0);
        else if (rw.kind === "chain" && rw.id) grantChain(prof, rw.id, getSpiritChain(rw.id));
        else if (rw.kind === "cosmetic" && rw.id) {
          prof.ownedCosmetics = prof.ownedCosmetics || { chain: [], char: [] };
          const ck = rw.cosmeticKind === "char" ? "char" : "chain";
          if (!prof.ownedCosmetics[ck].includes(rw.id)) prof.ownedCosmetics[ck].push(rw.id);
        }
        saveProfile(prof);
      }
      send(conn.ws, { t: "bp", ok: r.ok, reason: r.reason || null, tier: msg.tier, track: msg.track,
        bpSeasonId: prof.bpSeasonId, bpXp: prof.bpXp || 0, bpClaimed: prof.bpClaimed || [],
        gold: prof.gold || 0, essence: prof.essence || 0,
        ownedCosmetics: prof.ownedCosmetics || { chain: [], char: [] }, chains: prof.chains || [] });
      break;
    }

    case "buyUpgrade": {
      const s = world.sessions.get(conn.playerId);
      if (!s) return;
      if (s.state !== "idle") { // upgrades bought between runs only
        send(conn.ws, { t: "upgrades", ok: false, locked: true, gold: s.profile.gold || 0, upgrades: s.profile.upgrades || {} });
        return;
      }
      const r = purchaseUpgrade(s.profile, getUpgradeDef(String(msg.upgradeId || "")));
      if (r.ok) saveProfile(s.profile);
      send(conn.ws, { t: "upgrades", ok: r.ok, reason: r.reason, gold: s.profile.gold || 0, upgrades: s.profile.upgrades || {} });
      break;
    }

    case "combatAction": {
      const s = world.sessions.get(conn.playerId);
      if (!s || s.state !== "in_round") return;
      // Validate the incoming id (task 49): must be a string we issued. A non-string (object/
      // number from a crafted client) must never reach a Map lookup or downstream logic.
      if (typeof msg.combatId !== "string") return;
      // PvP duel (P3-T5)? Route there. Else the PvE path below.
      const pvp = world.pvps.get(msg.combatId);
      if (pvp) { handlePvpAction(world, pvp, conn.playerId, msg.action || {}, send).catch((e) => console.error("[pvp] action:", e)); break; }
      const session = world.combats.get(msg.combatId);
      // NC-11: also assert the combat belongs to the player's CURRENT round — a stale
      // combatId lingering across rounds must not resolve against the new round's state.
      if (!session || session.playerId !== conn.playerId || session.roundId !== s.roundId || session.resolving) return;
      // ITEM use (plan "Decide general items"): attach the player's OWNED item to the action so
      // the judge resolves it; it's consumed below once the turn resolves. Anti-cheat: only an
      // item the profile actually holds (by id) is honored.
      const action = msg.action || {};
      if (action.kind === "item") {
        const it = (s.profile.items || []).find((i) => i.id === action.itemId);
        // TQ-64: hand the judge the item's structured effect as an explicit directive so a tagged
        // consumable resolves consistently. The effect lives on the item (newer grants) or its pool
        // definition (getItem by name); un-tagged items fall back to plain free text.
        if (it) { const def = it.effect ? it : (getItem(it.name) || it); action.itemDef = { name: it.name, description: itemCombatDescription(def) }; }
      }
      // Resolution may be async (AI). Guard against double-actions while it runs.
      session.resolving = true;
      resolveCombatAction(session, action, session.rng)
        .then((res) => {
          session.resolving = false;
          if (!world.combats.has(session.combatId)) return; // torn down meanwhile
          if (session.usedItem) { // the turn resolved an item use → consume it now
            const idx = (s.profile.items || []).findIndex((i) => i.id === action.itemId);
            if (idx >= 0) s.profile.items.splice(idx, 1);
            session.usedItem = null;
            saveProfile(s.profile);
            res.items = s.profile.items; // reflect the consumed bag to the client
          }
          send(conn.ws, { t: "combatUpdate", combatId: session.combatId, ...res });
          if (res.outcome) endCombat(world, session, res, send);
        })
        .catch((e) => { session.resolving = false; console.error("[combat] resolve error:", e); });
      break;
    }

    // Free lobby Healer (task 50): heal the active team to full. Teams no longer
    // auto-heal at run start, so this is the (free) between-runs heal. Idle-only — the
    // team is locked once you queue/enter a round. Echoes the healed roster.
    case "heal": {
      const s = world.sessions.get(conn.playerId);
      if (!s) return;
      if (s.state !== "idle") { send(conn.ws, { t: "roster", ok: false, locked: true, team: s.profile.activeMonsters || [], vault: s.profile.vaultMonsters || [] }); break; }
      healTeam(s.profile.activeMonsters);
      saveProfile(s.profile);
      send(conn.ws, { t: "roster", ok: true, team: s.profile.activeMonsters || [], vault: s.profile.vaultMonsters || [] });
      break;
    }

    // Roster / vault management (P8-T2). Only between rounds (idle): the team is
    // locked once you queue/enter a round.
    case "getRoster": {
      const s = world.sessions.get(conn.playerId);
      if (!s) return;
      send(conn.ws, { t: "roster", team: s.profile.activeMonsters || [], vault: s.profile.vaultMonsters || [] });
      break;
    }

    case "setRoster": {
      const s = world.sessions.get(conn.playerId);
      if (!s) return;
      if (s.state !== "idle") {
        send(conn.ws, { t: "roster", ok: false, locked: true, team: s.profile.activeMonsters || [], vault: s.profile.vaultMonsters || [] });
        return;
      }
      const ok = applyRoster(s.profile, msg.activeIds);
      if (ok) saveProfile(s.profile);
      send(conn.ws, { t: "roster", ok, team: s.profile.activeMonsters || [], vault: s.profile.vaultMonsters || [] });
      break;
    }

    case "release": {
      // INV-T7 (MP half): free an owned monster for an Essence + level-scaled-gold
      // refund via the shared `releaseMonster` rule (same reward + keep-≥1-active
      // guard as SP). Idle-gated like setRoster — releasing mid-run could drop an
      // in-combat monster. The reply carries the reward + synced wallet so the
      // client can toast and update gold/essence.
      const s = world.sessions.get(conn.playerId);
      if (!s) return;
      if (s.state !== "idle") {
        send(conn.ws, { t: "roster", ok: false, locked: true, team: s.profile.activeMonsters || [], vault: s.profile.vaultMonsters || [] });
        return;
      }
      const r = releaseMonster(s.profile, msg.monsterId);
      if (r.ok) saveProfile(s.profile);
      send(conn.ws, {
        t: "roster", ok: r.ok, released: true, reason: r.reason || null, reward: r.reward || null,
        gold: s.profile.gold || 0, essence: s.profile.essence || 0,
        team: s.profile.activeMonsters || [], vault: s.profile.vaultMonsters || [],
      });
      break;
    }

    case "ping":
      send(conn.ws, { t: "pong", t0: msg.t0, t1: Date.now() });
      break;
  }
}

// Roster rearrange now lives in the shared inventory engine (PT2-T11 PARITY-3 —
// SP + MP apply a roster by one rule); imported above. Re-exported here so the
// `setRoster` handler + the tests that import it from this module keep working.
export { applyRoster };

export function removePlayer(world, playerId, send = () => {}) {
  if (!playerId) return;
  const s = world.sessions.get(playerId);
  if (!s) return;
  if (s.state === "in_round") {
    // Q12: don't drop them immediately — keep their round slot for a grace window
    // so they can reconnect and resume. Any active fight is dropped (resume roaming).
    const round = world.rounds.get(s.roundId);
    const rp = round?.players.get(playerId);
    // No-contest drop on disconnect: return the abandoned monster(s) to the shared map (shared rule
    // with endRunForPlayer) so a mid-fight disconnect doesn't leak them from the round.
    if (rp?.inCombat) { dropCombatNoContest(world, round, rp.inCombat); rp.inCombat = null; }
    if (rp?.inPvp) endPvpFor(world, playerId, send); // end any duel (no-contest)
    // Drop any of this player's in-flight projectiles so they don't orphan.
    if (round?.projectiles) round.projectiles = round.projectiles.filter((pr) => pr.owner !== playerId);
    s.disconnected = true;
    s.disconnectedAt = Date.now();
    return; // session + round membership kept; sweepDisconnected handles expiry
  }
  if (s.state === "queued") world.queue = world.queue.filter((id) => id !== playerId);
  world.sessions.delete(playerId);
  if (world.queue.length === 0) world.formingAtTick = null;
}

export function tickWorld(world, dt, send) {
  world.tick++;
  sweepDisconnected(world, send);
  matchmake(world, send);
  for (const round of world.rounds.values()) tickRound(world, round, dt, send);
}

// Q12: a disconnected in-round player who doesn't reconnect within the grace
// window is treated as a death (loses the active team, per Q10), then dropped.
function sweepDisconnected(world, send) {
  for (const [id, s] of world.sessions) {
    if (!s.disconnected || Date.now() - s.disconnectedAt <= DISCONNECT_GRACE_MS) continue;
    const round = s.roundId ? world.rounds.get(s.roundId) : null;
    if (round && round.players.get(id)) endRunForPlayer(world, round, id, "disconnect", send);
    world.sessions.delete(id);
  }
}

// Resume a reconnected player into their in-progress round at their current
// position (reuses the client's roundStart path; the next snapshot syncs time/zone).
function resumeRound(world, s, round, rp, send) {
  const ids = [...round.players.keys()];
  send(s.ws, {
    t: "roundStart",
    roundId: round.roundId,
    seed: round.seed,
    mapSize: round.mapSize,
    spawn: { x: Math.round(rp.x), y: Math.round(rp.y) },
    you: { id: s.profile.id, nickname: s.profile.name },
    players: ids.filter((o) => o !== s.profile.id).map((o) => ({ id: o, name: world.sessions.get(o)?.profile.name })),
    durationS: GAME.ROUND_DURATION_S,
    // NC-10: include the live round state so a resumed player renders the correct
    // zone / timer / portals / chests immediately, instead of flashing the fresh-round
    // defaults until the first snapshot (~133ms). Matters on every redeploy reconnect.
    time: Math.ceil(round.remaining ?? 0),
    circle: round.circle || null,
    portals: round.portals || [],
    chests: (round.chests || [])
      .filter((c) => sqDist(c.x, c.y, rp.x, rp.y) <= AOI_RADIUS * AOI_RADIUS)
      .map((c) => ({ id: c.id, x: c.x, y: c.y })),
    resumed: true,
  });
}

// Form a round when the queue is full, or the countdown elapsed with ≥ minPlayers.
function matchmake(world, send) {
  const full = world.queue.length >= GAME.MAX_PLAYERS;
  const countdownDone =
    world.formingAtTick !== null &&
    world.tick >= world.formingAtTick &&
    world.queue.length >= world.cfg.minPlayers;
  if (!full && !countdownDone) return;

  const ids = world.queue.splice(0, GAME.MAX_PLAYERS);
  world.formingAtTick = world.queue.length > 0 ? world.tick + world.cfg.countdownTicks : null;
  formRound(world, ids, send);
}

// Create a round for a specific set of player ids and kick off async map gen. Shared by the
// matchmaker (MP) and the instant solo path (SP) — both run the SAME server-authoritative round,
// so single-player progression (catches/loot/xp) is server-resolved + cheat-proof.
function formRound(world, ids, send) {
  const round = {
    roundId: "r" + world.nextRound++,
    seed: randomSeed(),
    phase: "loading", // becomes "active" once the map is generated
    startedAtMs: Date.now(),
    players: new Map(),
    map: null,
  };
  world.rounds.set(round.roundId, round);

  for (const id of ids) {
    const s = world.sessions.get(id);
    if (!s) continue;
    s.state = "in_round";
    s.roundId = round.roundId;
    round.players.set(id, { x: 0, y: 0, pendingMove: null, lastSeq: 0, spawned: false });
    send(s.ws, { t: "matchFound", roundId: round.roundId, players: round.players.size });
  }

  // Generate the round's map from its seed off the tick loop, then spawn players.
  // Fire-and-forget, but never let a rejection escape (it would otherwise become
  // an unhandled rejection); generateRound also try/catches the gen itself.
  generateRound(world, round, send).catch((e) => console.error("[tamers-quest] generateRound:", e));
  return round;
}

// Async map generation + spawn assignment. The round stays "loading" (unticked)
// until the map is ready, then each player gets a real walkable spawn + roundStart.
async function generateRound(world, round, send) {
  let map = null;
  try {
    map = await generateMap(null, round.seed);
  } catch (e) {
    console.error(`[tamers-quest] map gen failed for ${round.roundId}:`, e);
  }
  if (!world.rounds.has(round.roundId)) return; // everyone left during generation

  round.map = map;
  const spawnRng = makeRng((round.seed ^ 0x9e3779b9) >>> 0); // distinct stream from map gen
  const E = GAME.EFFECTIVE_TILE;

  // Round monsters in world space + a deterministic visible/hidden split
  // (decision Q2: "some invisible, some not"). Hidden ones only reveal up close.
  round.monsters = (map?.monsters || []).map((m) => ({
    id: m.id, typeName: m.typeName, level: m.level,
    x: m.tileX * E, y: m.tileY * E,
    hidden: hashString(String(m.id)) % 100 < world.cfg.hiddenMonsterPct,
    // Wild-monster approach: a deterministic subset are "hunters" that slowly walk toward a nearby
    // player (tickMonsterApproach). Distinct hash stream from `hidden` so the two are independent;
    // only VISIBLE hunters move (hidden ones stay ambushers).
    approacher: hashString("hunt:" + String(m.id)) % 100 < world.cfg.monsterApproachPct,
  }));

  const ids = [...round.players.keys()];
  // GP-5: spread player spawns so 16 players don't all start on the same cluster.
  const spawnTiles = map ? findSpreadSpawns(map.voidMap, spawnRng, ids.length, undefined, map.tileMap, map.reachMap) : null;

  for (const [idx, id] of ids.entries()) {
    const rp = round.players.get(id);
    const s = world.sessions.get(id);
    if (!rp || !s) continue;
    const tile = spawnTiles ? spawnTiles[idx] : { x: 200, y: 200 };
    rp.x = tile.x * E;
    rp.y = tile.y * E;
    rp.stamina = GAME.SPRINT.STAMINA_MAX;
    rp.spawned = true;
    // Task 50: teams NO LONGER auto-heal at run start — heal at the lobby Healer (free,
    // the `heal` message) between runs. Entering with an injured team is a real decision.
    // (SP game.js stopped run-start healing too.) resumeRound (reconnect) never healed.
    bumpStat(s.profile, "runs"); // P8-T1 (initial entry only; resumeRound doesn't bump)
    s.runStart = runStartSnapshot(s.profile); // P8-T3: baseline for the round-end gains summary
    send(s.ws, {
      t: "roundStart",
      roundId: round.roundId,
      seed: round.seed, // clients regenerate the identical map from this
      mapSize: map ? map.mapSize : 400,
      spawn: { x: rp.x, y: rp.y }, // world px
      you: { id, nickname: s.profile.name },
      players: ids
        .filter((o) => o !== id)
        .map((o) => ({ id: o, name: world.sessions.get(o)?.profile.name })),
      durationS: GAME.ROUND_DURATION_S,
    });
  }
  round.mapSize = map ? map.mapSize : 400;
  round.portals = [];
  round.projectiles = []; // in-flight spirit chains (server-authoritative)
  round.nextProjectile = 1;
  round.chests = spawnChests(round, map); // loot chests against walls (chain loot)
  round.startedAtMs = Date.now(); // in-round clock starts after map generation
  round.phase = "active";

  // P5: occasionally grow the pool with a new AI monster (gated by config; costs
  // an OpenAI call). Fire-and-forget — it joins the pool for FUTURE rounds and
  // never blocks this round's start.
  if (world.cfg.monsterGenRate > 0 && Math.random() < world.cfg.monsterGenRate) {
    generateMonster().catch((e) => console.error("[content] generateMonster:", e.message));
  }
}

// Wild-monster approach: a deterministic SUBSET of monsters (`approacher`, visible only) slowly
// walks toward the NEAREST non-fighting player within aggro range, sliding along walls exactly
// like the player (isWalkable, per-axis). Most monsters stay put. No extra snapshot payload — the
// client derives the walk animation + facing from the resulting position deltas (monsterRender),
// just like it does for rival players. A hunter that reaches encounterRadius is engaged by the
// caller's encounter check, which removes it from round.monsters (so it stops being moved).
function tickMonsterApproach(world, round, dt) {
  const monsters = round.monsters || [];
  if (!monsters.length || world.cfg.monsterApproachPct <= 0) return;
  const targets = [];
  for (const rp of round.players.values()) if (rp.spawned && !rp.inCombat && !rp.inPvp) targets.push(rp);
  if (!targets.length) return; // nobody to hunt → everyone idles
  const aggro2 = world.cfg.monsterApproachRadius * world.cfg.monsterApproachRadius;
  const v = world.cfg.baseSpeed * world.cfg.monsterApproachSpeedFrac; // deliberately slow
  const maxXY = Math.max(0, (round.mapSize - 1) * GAME.EFFECTIVE_TILE);
  const R = GAME.PLAYER_RADIUS;
  const nowApp = Date.now();
  for (const mo of monsters) {
    if (!mo.approacher || mo.hidden) continue; // only flagged, visible hunters move
    if (mo.fleeUntil && mo.fleeUntil > nowApp) continue; // just fled from a player — don't immediately chase back
    // nearest non-fighting player
    let best = null, bd2 = Infinity;
    for (const rp of targets) { const dx = rp.x - mo.x, dy = rp.y - mo.y, d2 = dx * dx + dy * dy; if (d2 < bd2) { bd2 = d2; best = rp; } }
    if (!best || bd2 > aggro2) continue; // none in range → stays put (client renders idle)
    const len = Math.sqrt(bd2) || 1;
    const ux = (best.x - mo.x) / len, uy = (best.y - mo.y) / len;
    // Server-authoritative step, clamped to the map; per-axis wall collision so a hunter slides
    // along walls instead of passing through them (same rule as player movement).
    const nx = Math.min(maxXY, Math.max(0, mo.x + ux * v * dt));
    const ny = Math.min(maxXY, Math.max(0, mo.y + uy * v * dt));
    if (isWalkable(round.map, nx + Math.sign(ux) * R, mo.y)) mo.x = nx;
    if (isWalkable(round.map, mo.x, ny + Math.sign(uy) * R)) mo.y = ny;
  }
}

function tickRound(world, round, dt, send) {
  if (round.phase !== "active") return; // still generating the map
  const speed = world.cfg.baseSpeed;
  const maxXY = Math.max(0, (round.mapSize - 1) * GAME.EFFECTIVE_TILE); // play-area bound
  for (const rp of round.players.values()) {
    const locked = rp.inCombat || rp.inPvp;
    // GP-15: drop any queued move while locked (in combat/PvP). Movement is skipped
    // below when locked, but without this the move that was pending when the fight
    // started would survive untouched and get applied on the FIRST tick after combat
    // ends — a one-frame lurch in a stale direction. (pendingThrow is already nulled
    // each tick in processThrows, so only pendingMove can go stale.)
    if (locked) rp.pendingMove = null;
    const moving = !locked && !!rp.pendingMove;
    // Sprint + stamina (server-authoritative). Stamina ticks every frame for
    // every player (regen even while idle/fighting), drains while sprinting.
    if (rp.stamina == null) rp.stamina = GAME.SPRINT.STAMINA_MAX;
    const sprinting = moving && sprintingNow({ sprint: rp.pendingMove.sprint, moving, stamina: rp.stamina, wasSprinting: rp.wasSprinting }, GAME);
    rp.stamina = tickStamina(rp.stamina, sprinting, dt, GAME);
    rp.wasSprinting = sprinting;
    if (!moving) continue; // movement locked while fighting / no input this tick
    let { dx, dy } = rp.pendingMove;
    if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }
    const v = speed * sprintMult(sprinting, GAME); // uniform speed: per-biome terrain modifier removed 2026-06-09
    // Server-authoritative position, clamped to the map (anti-cheat: no walking
    // infinitely off-map; speed/direction already clamped at input). Per-axis tile
    // collision so you slide along walls instead of passing through them.
    const nx = Math.min(maxXY, Math.max(0, rp.x + dx * v * dt));
    const ny = Math.min(maxXY, Math.max(0, rp.y + dy * v * dt));
    // PT2-T06: collide the player's leading body EDGE, not their center, so a wall
    // stops you where your sprite meets it (collider matches the visual) instead of
    // letting the body overlap ~a radius into the wall. Per-axis (slide along walls);
    // only the moving axis is offset, so the perpendicular footprint stays a point
    // and narrow corridors don't get blocked.
    const R = GAME.PLAYER_RADIUS;
    if (isWalkable(round.map, nx + Math.sign(dx) * R, rp.y)) rp.x = nx;
    if (isWalkable(round.map, rp.x, ny + Math.sign(dy) * R)) rp.y = ny;
    rp.pendingMove = null;
  }

  // Loot chests: open any chest a roaming player has reached.
  processChests(world, round, send);

  // Spirit-chain throws: spawn queued projectiles, then advance + resolve hits.
  processThrows(world, round);
  stepProjectiles(world, round, dt, send);

  // Wild monsters slowly hunt nearby players (moves the "approacher" subset); a hunter that
  // reaches encounterRadius this tick is then picked up by the encounter check just below.
  tickMonsterApproach(world, round, dt);

  // Encounter detection (instanced duel — others keep moving). Hidden monsters
  // ambush too, since they stay in round.monsters until engaged.
  const ER2 = world.cfg.encounterRadius * world.cfg.encounterRadius, nowEnc = Date.now();
  for (const [id, rp] of round.players) {
    if (rp.inCombat || rp.inPvp) continue;
    const entry = (round.monsters || []).find((mo) => {
      if (mo.fleeUntil && mo.fleeUntil > nowEnc) return false; // recently fled this/another player — give room to walk off
      const dx = mo.x - rp.x, dy = mo.y - rp.y;
      return dx * dx + dy * dy <= ER2;
    });
    if (entry) startCombat(world, round, id, entry, send);
  }

  // FFA PvP on collision (P3-T5) — gated until the client UI ships.
  if (world.cfg.pvpEnabled) maybeStartPvp(world, round, send);

  // Extraction loop: timer, shrinking safe zone, portals, extract/zone/timeout.
  updateExtraction(world, round, dt, send);

  if (world.tick % 2 !== 0) return; // ~half tick-rate snapshots; AoI filtering in P2
  const all = [...round.players.entries()];
  const monsters = round.monsters || [];
  const AOI2 = AOI_RADIUS * AOI_RADIUS, REVEAL2 = REVEAL_RADIUS * REVEAL_RADIUS; // hoist out of the per-entity filter predicates
  for (const [id, rp] of all) {
    const s = world.sessions.get(id);
    if (!s) continue;
    // AoI: visible monsters within AOI_RADIUS, hidden ones only within REVEAL_RADIUS.
    const nearbyMonsters = filterMap(monsters,
      (mo) => { const dx = mo.x - rp.x, dy = mo.y - rp.y; return dx * dx + dy * dy <= (mo.hidden ? REVEAL2 : AOI2); },
      (mo) => ({ id: mo.id, typeName: mo.typeName, level: mo.level, x: Math.round(mo.x), y: Math.round(mo.y) }));
    send(s.ws, {
      t: "snapshot",
      tick: world.tick,
      roundId: round.roundId,
      you: { id, x: Math.round(rp.x), y: Math.round(rp.y), ack: rp.lastSeq, team: teamHp(s.profile), chains: chainsView(s.profile), equippedChainId: s.profile.equippedChainId || null, equippedChainIds: s.profile.equippedChainIds || [], gold: s.profile.gold || 0, essence: s.profile.essence || 0, upgrades: s.profile.upgrades || {}, stamina: Math.round(rp.stamina ?? GAME.SPRINT.STAMINA_MAX), danger: Math.round((rp.danger || 0) * 1000) / 1000 },
      // Q13: rivals are AoI-filtered like monsters — only those within view range
      // appear (a threat you discover, not always-on blips).
      players: filterMap(all,
        ([oid, orp]) => oid !== id && sqDist(orp.x, orp.y, rp.x, rp.y) <= AOI2,
        ([oid, orp]) => {
          const op = world.sessions.get(oid)?.profile; // one session lookup per rival, not three
          return {
            id: oid,
            name: op?.name,
            x: Math.round(orp.x),
            y: Math.round(orp.y),
            skinId: op?.equippedSkinId || null, // CN-12: rivals' chain cosmetic
            charId: op?.equippedCharId || null, // rivals' character body-model skin
          };
        }),
      monsters: nearbyMonsters,
      // In-flight spirit chains, AoI-filtered like monsters/players. vx,vy let the
      // client extrapolate between half-rate snapshots for smooth flight.
      projectiles: filterMap(round.projectiles || [],
        (pr) => sqDist(pr.x, pr.y, rp.x, rp.y) <= AOI2,
        (pr) => ({ id: pr.id, owner: pr.owner, x: Math.round(pr.x), y: Math.round(pr.y), vx: pr.vx, vy: pr.vy, chainId: pr.chainId })), // owner: TQ-180 client throw-gate (is MY chain out?)
      // Loot chests in view (AoI-filtered like monsters). Loot stays hidden
      // until opened — clients only learn position + that it's a chest.
      chests: filterMap(round.chests || [],
        (c) => sqDist(c.x, c.y, rp.x, rp.y) <= AOI2,
        (c) => ({ id: c.id, x: c.x, y: c.y })),
      time: Math.ceil(round.remaining ?? 0),
      circle: round.circle || null,
      portals: round.portals || [],
    });
  }
}

// Round timer, shrinking safe zone, portals, and extract/zone/timeout handling.
function updateExtraction(world, round, dt, send) {
  const cfg = world.cfg;
  const E = GAME.EFFECTIVE_TILE;
  const elapsed = (Date.now() - round.startedAtMs) / 1000;
  round.remaining = Math.max(0, cfg.roundDurationS - elapsed);

  const cx = (round.mapSize / 2) * E;
  const cy = (round.mapSize / 2) * E;
  const fullR = (round.mapSize / 2) * E;
  if (elapsed >= cfg.circleStartS) {
    const span = Math.max(1, cfg.roundDurationS - cfg.circleStartS);
    round.circleRadius = Math.max(0, (round.remaining / span) * fullR);
  } else {
    round.circleRadius = fullR;
  }
  round.circle = { x: Math.round(cx), y: Math.round(cy), r: Math.round(round.circleRadius) };

  // Portals appear once the circle starts closing.
  if (elapsed >= cfg.circleStartS && round.map) {
    const want = Math.floor((elapsed - cfg.circleStartS) / cfg.portalIntervalS) + 1;
    while (round.portals.length < want) {
      if (!spawnPortal(round, cx, cy)) break;
    }
  }

  for (const [id, rp] of [...round.players]) {
    const s = world.sessions.get(id);
    if (!s) continue;
    // Extraction: step onto a portal → survive with your gains.
    if (round.portals.some((p) => sqDist(p.x, p.y, rp.x, rp.y) <= EXTRACT_RADIUS * EXTRACT_RADIUS)) {
      endRunForPlayer(world, round, id, "extracted", send);
      continue;
    }
    // Timeout: failed to escape in time.
    if (round.remaining <= 0) { endRunForPlayer(world, round, id, "timeout", send); continue; }
    // Zone DANGER meter (not while in an instanced fight or duel — you can't reposition). OUTSIDE
    // the closing circle the bar fills to full over dangerFillS → death; back in SAFETY it drains
    // to empty over dangerDrainS (linear). Replaces flat storm HP-attrition as the zone-death rule.
    if (elapsed >= cfg.circleStartS && !rp.inCombat && !rp.inPvp) {
      const outside = sqDist(cx, cy, rp.x, rp.y) > round.circleRadius * round.circleRadius;
      if (outside) {
        rp.danger = Math.min(1, (rp.danger || 0) + dt / cfg.dangerFillS);
        if (rp.danger >= 1) { endRunForPlayer(world, round, id, "zone", send); continue; }
      } else if (rp.danger > 0) {
        rp.danger = Math.max(0, rp.danger - dt / cfg.dangerDrainS);
      }
    }
  }
}

export function spawnPortal(round, cx, cy) {
  const E = GAME.EFFECTIVE_TILE;
  const map = round.map;
  if (!map) return false;
  // GP-8: portals were placed with Math.random() → non-reproducible, breaking the
  // seeded/replayable-round design (every other placement uses the round seed). Use
  // a persistent per-round seeded stream (lazy-init; distinct constant from the
  // map-gen and spawn streams) so a given seed always yields the same portals.
  const rng = round.portalRng || (round.portalRng = makeRng((round.seed ^ 0x50525400) >>> 0));
  // GP-7: spread portals so far-edge players always have a reachable exit. Assign each
  // new portal to the next quadrant in rotation (the first 4 cover all 4 quadrants),
  // placed out in that quadrant (min distance from center) rather than clustered. Fall
  // back to a full-circle search if the assigned quadrant has no walkable tile in range.
  const quad = round.portals.length % 4;
  for (let i = 0; i < 200; i++) {
    const inQuad = i < 150; // first 150 tries respect the quadrant, then fall back
    const ang = inQuad ? quad * (Math.PI / 2) + rng.next() * (Math.PI / 2) : rng.next() * Math.PI * 2;
    const dist = (inQuad ? 0.3 + rng.next() * 0.55 : rng.next() * 0.85) * round.circleRadius;
    const tx = Math.floor((cx + Math.cos(ang) * dist) / E);
    const ty = Math.floor((cy + Math.sin(ang) * dist) / E);
    if (tx >= 0 && tx < round.mapSize && ty >= 0 && ty < round.mapSize && map.voidMap[tx]?.[ty]) {
      round.portals.push({ x: tx * E, y: ty * E });
      return true;
    }
  }
  return false;
}

// ── Round-end gains summary (P8-T3) ──
// Per-run deltas shown on the extracted/died screen. Baselined at run start
// (generateRound) on the session, diffed at endRun before the team is mutated.
const teamXpSum = (team) => (team || []).reduce((n, m) => n + (m.xp || 0), 0);
const teamLevelSum = (team) => (team || []).reduce((n, m) => n + (m.level || 0), 0);
export function runStartSnapshot(profile) {
  return {
    caught: (profile.stats && profile.stats.caught) || 0,
    xp: teamXpSum(profile.activeMonsters),
    levels: teamLevelSum(profile.activeMonsters),
    at: Date.now(),
  };
}
export function computeRunGains(s) {
  const start = s && s.runStart;
  const prof = s && s.profile;
  if (!start || !prof) return { caught: 0, xpGained: 0, levelUps: 0, survivedS: 0 };
  const caughtNow = (prof.stats && prof.stats.caught) || 0;
  return {
    caught: Math.max(0, caughtNow - start.caught),
    xpGained: Math.max(0, teamXpSum(prof.activeMonsters) - start.xp),
    levelUps: Math.max(0, teamLevelSum(prof.activeMonsters) - start.levels),
    survivedS: Math.max(0, Math.round((Date.now() - start.at) / 1000)),
  };
}

// Append a compact record of a finished run to the profile's match history (newest first,
// capped). Powers the profile page's "match history" — the per-run detail the lifetime stat
// counters (extractions/deaths/caught) can't show. `result` is "extracted" | "died".
const MATCH_HISTORY_MAX = 20;
export function logRun(profile, result, reason, gains) {
  if (!profile) return;
  if (!Array.isArray(profile.matchHistory)) profile.matchHistory = [];
  profile.matchHistory.unshift({
    at: Date.now(), result, reason,
    caught: gains?.caught || 0, xp: gains?.xpGained || 0,
    levelUps: gains?.levelUps || 0, survivedS: gains?.survivedS || 0,
  });
  if (profile.matchHistory.length > MATCH_HISTORY_MAX) profile.matchHistory.length = MATCH_HISTORY_MAX;
}

// No-contest teardown of an in-progress PvE fight: return the engaged wild monster (+ any
// multi/area cluster) to the shared map BEFORE deleting the combat, so abandoning a fight
// (disconnect / extract-while-engaged / round end) doesn't permanently leak it from the round
// for every other player. startCombat removed them from round.monsters; only a win/catch should
// keep them gone. Single source for the rule — used by removePlayer and endRunForPlayer.
function dropCombatNoContest(world, round, combatId) {
  const cs = combatId && world.combats.get(combatId);
  if (cs && round?.monsters) {
    if (cs.monsterEntry) round.monsters.push(cs.monsterEntry);
    for (const e of cs.queue || []) round.monsters.push(e);
  }
  if (combatId) world.combats.delete(combatId);
}

function endRunForPlayer(world, round, id, reason, send) {
  const s = world.sessions.get(id);
  const rp = round.players.get(id);
  // A player on a portal who is engaged the same tick (hunters now chase onto portals) starts a
  // combat, then extracts in updateExtraction — return that monster instead of leaking it. (Defeat
  // already cleared rp.inCombat upstream → no-op; on a timeout the round is ending anyway.)
  if (rp?.inCombat) dropCombatNoContest(world, round, rp.inCombat);
  if (rp?.inPvp) endPvpFor(world, id, send); // end any duel (no-contest) before leaving
  round.players.delete(id);
  // Record for the admin live-ops view (P7-T4); keep the last ~30.
  world.recentResults.push({ name: s?.profile?.name || "?", reason, at: Date.now() });
  if (world.recentResults.length > 30) world.recentResults.shift();
  // Kill feed (P8-T5): tell the players still in the round who just left and why
  // (`reason` is "extracted" | "timeout" | "zone" | "disconnect"). The leaver is
  // already removed above, so this reaches the survivors only.
  broadcastToRound(world, round, { t: "killfeed", victim: s?.profile?.name || "?", cause: reason, at: Date.now() }, send);
  if (s) {
    s.state = "idle";
    s.roundId = null;
    const gains = computeRunGains(s); // P8-T3: compute before death replaces the team
    s.runStart = null;
    let term;
    if (reason === "extracted") {
      grantExtractRewards(s.profile); // extract gold + XP bonus (shared engine helper — P10-T3). TQ-203/TQ-207: survivors are NOT auto-healed — they keep injured HP; restore at the lobby Healer.
      finalizeRunChains(s.profile, true, getSpiritChain); // run-found chains banked
      bumpStat(s.profile, "extractions"); // P8-T1
      logRun(s.profile, "extracted", reason, gains); // profile-page match history
      saveProfile(s.profile);
      term = { t: "extracted", reason, team: s.profile.activeMonsters, stats: s.profile.stats, gains };
    } else {
      // Q10: death loses the active run team (vault kept per Q9). Refill from the
      // vault, else roll fresh starters so a player is never left with nothing.
      const prof = s.profile;
      bumpStat(prof, "deaths"); // P8-T1
      logRun(prof, "died", reason, gains); // profile-page match history (before the team is replaced)
      loseRunTeam(prof, rollStarters); // Q10: lose the run team → refill from vault / starters (shared SP↔MP rule)
      finalizeRunChains(prof, false, getSpiritChain); // run-found chains lost on death
      saveProfile(prof);
      term = { t: "died", reason, team: prof.activeMonsters, stats: prof.stats, gains };
    }
    // Q12: if the run ended while the player was DISCONNECTED (their round timed out or the storm
    // killed their team during the grace window), the socket is dead so this terminal message is
    // lost — and a bare `welcome` on reconnect would leave them frozen on a dead round view. Stash
    // it and replay on reconnect (the join handler delivers it) so they always get their result.
    if (s.disconnected) s.pendingResult = term; else send(s.ws, term);
  }
  if (round.players.size === 0) world.rounds.delete(round.roundId);
}

// Broadcast a message to every connected player currently in a round — kill feed
// (P8-T5) and any future round-wide notices. Exported for tests.
export function broadcastToRound(world, round, msg, send) {
  if (!round) return;
  for (const pid of round.players.keys()) {
    const sess = world.sessions.get(pid);
    if (sess && sess.ws) send(sess.ws, msg);
  }
}

// Compact per-monster HP for the client HUD (reflects storm/combat damage live).
// Defensive on type lookup — this runs in the tick loop for every player.
function teamHp(profile) {
  return (profile.activeMonsters || []).map((m) => {
    const mt = getMonsterType(m.typeName);
    const max = mt ? getMonsterMaxHp(mt, m.level) : Math.round(m.currentHealth) || 1;
    return { hp: Math.max(0, Math.round(m.currentHealth)), max };
  });
}

// Compact mirror of a profile's chain inventory for the snapshot, so the client
// HUD reflects throwCount/durability the moment the server mutates them.
function chainsView(profile) {
  return (profile.chains || []).map((c) => {
    const v = { chainId: c.chainId, throwCount: c.throwCount, durability: c.durability };
    // Surface the provisional (run-found) flag so the client HUD can show what's "at
    // risk" on death (parity with SP). Only sent when true → negligible bandwidth.
    if (c.runFound) v.runFound = true;
    return v;
  });
}


function sqDist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

// Single-pass filter+map — avoids the throwaway intermediate array that
// arr.filter(pred).map(fn) allocates. Used for the per-player snapshot AoI
// projections, which run for every player on every snapshot.
function filterMap(arr, pred, fn) {
  const out = [];
  for (let i = 0; i < arr.length; i++) { const x = arr[i]; if (pred(x)) out.push(fn(x)); }
  return out;
}

// Begin an instanced PvE fight between a player and a wild monster entry.
// `opts.initiator` ("player" when engaged by a thrown chain) grants first-turn
// initiative; `opts.chainId` is the chain used (tier modifies capture).
function startCombat(world, round, playerId, entry, send, opts = {}) {
  const s = world.sessions.get(playerId);
  if (!s) return;
  const team = s.profile.activeMonsters || [];
  const activeIdx = team.findIndex((m) => m.currentHealth > 0);
  if (activeIdx < 0) return; // no usable monster — ignore the encounter
  const rp = round.players.get(playerId);
  // Skip if the player is already engaged — in a PvE fight OR a PvP duel. The inPvp
  // check matters for the thrown-chain path: a player can throw while roaming, then
  // get pulled into a duel before the in-flight projectile lands on a wild monster;
  // without this guard that hit would start a PvE fight on top of the duel (the player
  // ends up in two fights). Every other engagement gate (throw, roam-collision,
  // maybeStartPvp) already checks both flags — this completes the set.
  if (!rp || rp.inCombat || rp.inPvp) return;

  // FGT-T1: combat is AI-only. With no judge configured (no OPENAI_API_KEY) don't
  // start a silent deterministic fight — skip the engagement and tell the player
  // (throttled so a stand-on-a-monster tick loop can't spam). Prod always has the
  // key, so this is effectively a local-dev guard.
  if (!aiEnabled()) {
    const now = Date.now();
    if (!rp._aiWarnAt || now - rp._aiWarnAt > 8000) {
      rp._aiWarnAt = now;
      send(s.ws, { t: "combatUnavailable", reason: "The combat judge is offline — combat needs a connection." });
    }
    return;
  }

  // Q8: partial energy restore per encounter so a depleted team can still fight.
  for (const m of team) if (m.currentHealth > 0) restoreEnergyPartial(m, world.cfg.energyRestorePct);

  // Engaged monsters leave the map. The primary + any multi/area `queue` are
  // removed together HERE (after the early-return guards) so a failed start never
  // strands clustered monsters off the map.
  const queue = opts.queue || [];
  round.monsters = round.monsters.filter((m) => m !== entry && !queue.includes(m));
  const enemy = makeEnemy(entry);
  const combatId = secureId("c"); world.nextCombat++; // unguessable id (task 49); counter kept for metrics
  world.combats.set(combatId, {
    combatId, playerId, roundId: round.roundId,
    team, activeIdx, enemy, monsterEntry: entry, rng: makeRng(randomSeed()),
    initiator: opts.initiator === "player" ? "player" : "enemy",
    chainId: opts.chainId || s.profile.equippedChainId || null,
    queue, // remaining monsters in a multi/area capture
  });
  rp.inCombat = combatId;

  send(s.ws, {
    t: "combatStart",
    combatId,
    enemy: monSnap(enemy),
    active: monSnap(team[activeIdx]),
    attacks: attacksFor(team[activeIdx]),
  });
}

// Finish a combat: unlock movement, apply outcome (catch adds to roster, flee
// returns the monster to the map), persist, and notify the client.
function endCombat(world, session, res, send) {
  const s = world.sessions.get(session.playerId);
  if (!s) { world.combats.delete(session.combatId); return; }
  const round = world.rounds.get(session.roundId);
  const rp = round?.players.get(session.playerId);
  if (rp) rp.inCombat = null;

  let caughtPlacement = null; // "team" | "vault" | "released" | null — surfaced to the client
  if (res.outcome === "caught") {
    const e = session.enemy;
    // CB-9: stabilize the catch — it was joining at its near-death combat HP (e.g.
    // 3/300), useless for the rest of the run. Heal to a usable fraction of max.
    const cs = getMonsterStats(getMonsterType(e.typeName), e.level);
    const caught = {
      id: newMonsterId(),
      typeName: e.typeName, name: e.typeName, level: e.level, xp: 0,
      currentHealth: Math.max(1, Math.round(cs.health * GAME.CATCH_HEAL_FRACTION)),
      currentEnergy: Math.round(cs.energy * GAME.CATCH_HEAL_FRACTION), status: null,
    };
    const prof = s.profile;
    // PT2-T11 PARITY-3: team-or-vault placement (capped) is the shared engine rule
    // now (engine/inventory.js), so SP + MP can't drift on the vault cap.
    caughtPlacement = addCaughtMonster(prof, caught);
    // Only count a catch the player actually KEEPS. A full team+vault drops the monster
    // ("released"); counting it would inflate both the lifetime "caught" stat AND the
    // run-gains summary (computeRunGains reads the same counter as a delta), telling the
    // player they kept a monster that vanished. The chain charge is still spent below —
    // the capture itself succeeded; there was just nowhere to store the result.
    if (caughtPlacement !== "released") bumpStat(prof, "caught"); // P8-T1
    consumeChainCharge(prof, session.chainId); // spend one capture charge
  } else if (res.outcome === "won") {
    s.profile.gold = (s.profile.gold || 0) + defeatGold(s.profile, session.enemy?.level || 1);
    grantPlayerXp(s.profile, playerDefeatXp(session.enemy?.level || 1)); // TQ-186: account-XP prestige track per wild defeat
    grantBattlePassXp(s.profile, battlePassDefeatXp(session.enemy?.level || 1)); // TQ-182: battle-pass XP per wild defeat
    // TQ-132: no essence reward — essence is premium/paid, not earned in runs.
  } else if (res.outcome === "fled" && round && session.monsterEntry) {
    const me = session.monsterEntry;
    // Don't drop the fled monster on top of the player (they'd be re-engaged the same instant — flee
    // felt broken). Nudge it to a nearby WALKABLE spot away from the player, and give it a brief
    // cooldown so the encounter check + hunter approach leave it alone while the player walks off.
    if (rp && round.map) {
      const push = world.cfg.encounterRadius * 2.6;
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2, nx = rp.x + Math.cos(a) * push, ny = rp.y + Math.sin(a) * push;
        if (isWalkable(round.map, nx, ny)) { me.x = nx; me.y = ny; break; }
      }
    }
    me.fleeUntil = Date.now() + 4000;
    round.monsters.push(me); // monster returns to the map (displaced + on a short post-flee cooldown)
  }
  // won: monster stays removed. lost: handled just below (it ENDS the run).

  // Multi/area chain: flee/lose abandons the cluster (queued monsters go back to
  // the map so they're not lost); win/catch continues to the next queued monster.
  const cont = res.outcome === "won" || res.outcome === "caught";
  const queue = session.queue || [];
  if (!cont && round) for (const e of queue) round.monsters.push(e);

  // Q10: a combat WIPE is a DEFEAT — end the run with the team-loss penalty, exactly like
  // storm / timeout / disconnect (wiki §Outcomes: "Defeat (combat wipe, storm, timeout, or
  // disconnect) → lose the active run team"). Previously a wipe only sent a `combatEnd` and
  // dropped the player back into the overworld with a fainted team — who could then walk onto
  // an extraction portal and EXTRACT for a free full heal + gains, dodging the Q10 penalty
  // entirely (updateExtraction has no living-team check). endRunForPlayer applies loseRunTeam,
  // drops run-found chains, removes them from the round, and sends the "died" terminal — which
  // net.js handles by clearing the client combat overlay (state.combat = null). This mirrors
  // the existing timeout-DURING-combat path (updateExtraction times out without an inCombat guard).
  if (res.outcome === "lost") {
    world.combats.delete(session.combatId); // rp.inCombat was already cleared above, so endRun won't
    if (round) endRunForPlayer(world, round, session.playerId, "defeat", send);
    return;
  }

  // Task 46 / monster-gen spec: status effects are PER-FIGHT — the AI judge sets them
  // during a fight; clear the team's status once the fight ends (HP/energy persist).
  for (const m of s.profile.activeMonsters || []) m.status = null;
  saveProfile(s.profile);
  world.combats.delete(session.combatId);
  send(s.ws, {
    t: "combatEnd",
    combatId: session.combatId,
    outcome: res.outcome,
    caughtPlacement, // where a catch landed ("team"/"vault"/"released") so the client can tell the truth
    team: s.profile.activeMonsters,
    queued: cont && queue.length > 0, // hint: another multi/area fight follows
  });

  // Continue a multi/area capture: immediately engage the next queued monster
  // (thrower keeps initiative; the same chain keeps applying + consuming charges).
  if (cont && rp && queue.length && (s.profile.activeMonsters || []).some((m) => m.currentHealth > 0)) {
    const next = queue.shift();
    startCombat(world, round, session.playerId, next, send, { initiator: "player", chainId: session.chainId, queue });
  }
}

// Spend one capture charge on the chain used; remove it when depleted and
// re-point the equipped id at a remaining chain. Caller persists via saveProfile.
function consumeChainCharge(profile, chainId) {
  if (!chainId) return;
  const chains = profile.chains || [];
  const cs = chains.find((c) => c.chainId === chainId);
  if (!cs) return;
  cs.durability -= 1;
  if (cs.durability <= 0) {
    chains.splice(chains.indexOf(cs), 1);
    // Drop the spent chain from the 3-slot loadout, then backfill the freed slot from
    // the remaining inventory and re-point the active chain (CHAIN_SLOTS, 2026-06-10).
    profile.equippedChainIds = (profile.equippedChainIds || []).filter((id) => id !== chainId);
    ensureChainSlots(profile);
  }
}

// Place loot chests against walls, deterministically from the round seed.
// Each chest sits on a walkable tile adjacent to a wall/void and holds 1–2
// randomized chains (weighted by dropWeight via rollChainDrop).
function spawnChests(round, map) {
  const out = [];
  if (!map?.voidMap) return out;
  const E = GAME.EFFECTIVE_TILE, N = round.mapSize;
  const defs = getSpiritChains();
  const rng = makeRng((round.seed ^ 0x517cc1b7) >>> 0); // distinct stream from map/spawn gen
  const wall = (x, y) => x < 0 || x >= N || y < 0 || y >= N || !map.voidMap[x]?.[y] || map.tileMap?.[x]?.[y]?.collidable;
  const againstWall = (x, y) => wall(x - 1, y) || wall(x + 1, y) || wall(x, y - 1) || wall(x, y + 1);
  for (let i = 0; i < GAME.SPIRIT_CHAIN.CHESTS_PER_RUN; i++) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const tx = Math.floor(rng.next() * N), ty = Math.floor(rng.next() * N);
      if (wall(tx, ty) || !againstWall(tx, ty)) continue;
      const count = rng.next() < 0.35 ? 2 : 1;
      const loot = [];
      for (let n = 0; n < count; n++) { const d = rollChainDrop(defs, rng); if (d) loot.push(d.id); }
      // Item drop (plan "Decide general items"): ITEM_DROP_CHANCE per chest to hold one AI item; the
      // WHICH-item pick is RARITY-WEIGHTED (TQ-65) so rarer items drop less often. Both rolls use the
      // SEEDED rng so loot is reproducible. Empty pool → no item (graceful).
      const pool = getItems();
      const item = pool.length && rng.next() < ITEM_DROP_CHANCE ? rollItemFromPool(pool, rng.next()).name : null;
      if (loot.length || item) out.push({ id: `ch${i}`, x: tx * E + E / 2, y: ty * E + E / 2, loot, item });
      break;
    }
  }
  return out;
}

// Open a chest when a roaming player reaches it (server-authoritative grant).
// Granted chains are flagged run-found (provisional until extraction).
function processChests(world, round, send) {
  if (!round.chests || round.chests.length === 0) return;
  const r2 = GAME.SPIRIT_CHAIN.PICKUP_RADIUS * GAME.SPIRIT_CHAIN.PICKUP_RADIUS;
  for (const [id, rp] of round.players) {
    if (rp.inCombat || rp.inPvp) continue;
    const idx = round.chests.findIndex((c) => sqDist(c.x, c.y, rp.x, rp.y) <= r2);
    if (idx < 0) continue;
    const chest = round.chests[idx];
    const s = world.sessions.get(id);
    if (s) {
      for (const chainId of chest.loot || []) {
        const def = getSpiritChain(chainId);
        if (def) grantChain(s.profile, chainId, def, true);
      }
      // Item loot (plan "Decide general items"): grant the chest's item into the profile's
      // item bag, capped so repeated runs can't grow it unbounded (twin of the chain/vault caps).
      if (chest.item) {
        const def = getItem(chest.item);
        if (def) {
          s.profile.items = (s.profile.items || []);
          if (s.profile.items.length < GAME.ITEM_BAG_SIZE) {
            // TQ-64: carry the item's structured category/rarity/effect onto the bag entry so combat
            // can apply a consistent effect and the Items tab can show rarity (older items default).
            s.profile.items.push({ id: newMonsterId(), name: def.name, description: def.description, category: def.category, rarity: def.rarity, effect: def.effect });
          } else if (s.ws) {
            // TQ-66: bag full (ITEM_BAG_SIZE). The item is left behind rather than silently
            // lost — tell the player so a full bag is well-defined behaviour, mirroring the
            // full-vault "released" catch rule. They can free a slot in the Items tab to loot more.
            send(s.ws, { t: "lootNotice", text: `Bag full — left ${def.name} behind` });
          }
        }
      }
      saveProfile(s.profile); // TQ-132: chests no longer grant essence (premium/paid, not earned)
    }
    round.chests.splice(idx, 1);
  }
}

// Spawn queued spirit-chain throws (validated against authoritative state).
function processThrows(world, round) {
  for (const [id, rp] of round.players) {
    if (!rp.pendingThrow) continue;
    const pt = rp.pendingThrow;
    rp.pendingThrow = null;
    if (rp.inCombat || rp.inPvp) continue;
    // TQ-180: return-gated throw cooldown — at most one in-flight chain per player. Block a new
    // throw while this player's previous chain is still out (the boomerang hasn't returned yet); it
    // re-enables the moment the chain returns / is cleaned up (PROJECTILE_TTL_S frees a lost one).
    if (round.projectiles.some((pr) => pr.owner === id)) continue;
    const s = world.sessions.get(id);
    if (!s) continue;
    const chainId = pt.chainId || s.profile.equippedChainId;
    const cs = (s.profile.chains || []).find((c) => c.chainId === chainId);
    const def = cs && getSpiritChain(cs.chainId);
    if (!def || !canThrow(cs)) continue;
    const len = Math.hypot(pt.dx, pt.dy) || 1;
    round.projectiles.push({
      id: "pr" + round.nextProjectile++,
      owner: id,
      x: rp.x, y: rp.y,
      vx: (pt.dx / len) * def.throwSpeed,
      vy: (pt.dy / len) * def.throwSpeed,
      dist: 0, maxDist: def.throwRange, ttl: GAME.SPIRIT_CHAIN.PROJECTILE_TTL_S,
      chainId: def.id, speed: def.throwSpeed,
    });
    // Boomerang (user 2026-06-10): an overworld throw is FREE — the chain returns to the
    // tamer (stepProjectiles homes it back). No throwCount is spent; a chain is only
    // consumed (a durability charge) when it captures a monster in battle. So no profile
    // mutation here → nothing to persist.
  }
}

// Advance projectiles; resolve hits vs monsters (and players when PvP is on).
function stepProjectiles(world, round, dt, send) {
  if (!round.projectiles || round.projectiles.length === 0) return;
  const HR2 = GAME.SPIRIT_CHAIN.HIT_RADIUS * GAME.SPIRIT_CHAIN.HIT_RADIUS;
  const keep = [];
  for (const pr of round.projectiles) {
    pr.x += pr.vx * dt; pr.y += pr.vy * dt;
    pr.dist += pr.speed * dt; pr.ttl -= dt;

    // vs monsters
    const mon = (round.monsters || []).find((mo) => sqDist(mo.x, mo.y, pr.x, pr.y) <= HR2);
    if (mon) {
      const def = getSpiritChain(pr.chainId);
      let queue = [];
      if (def?.special === "multi") {
        // Hydra Lash: pull the nearest cluster into a sequential multi-capture.
        // startCombat removes the cluster from the map (after its start guards),
        // so a failed engage doesn't strand them.
        queue = clusterTargets(mon, (round.monsters || []).filter((m) => m !== mon),
          GAME.SPIRIT_CHAIN.MULTI_CHAIN_RADIUS, GAME.SPIRIT_CHAIN.MULTI_MAX_TARGETS - 1);
      }
      startCombat(world, round, pr.owner, mon, send, { initiator: "player", chainId: pr.chainId, queue });
      continue;
    }

    // vs other players (PvP engage — thrower gets initiative)
    if (world.cfg.pvpEnabled) {
      let hitPid = null;
      for (const [oid, orp] of round.players) {
        if (oid === pr.owner || orp.inCombat || orp.inPvp) continue;
        if (sqDist(orp.x, orp.y, pr.x, pr.y) <= HR2) { hitPid = oid; break; }
      }
      if (hitPid) { startPvp(world, round, pr.owner, hitPid, send, pr.owner); continue; }
    }

    // expiry / boomerang: overworld throws are FREE (user 2026-06-10) — a chain that
    // reaches its range or a wall turns around and homes back to the tamer, then despawns
    // when it returns (or on the ttl safety cap). It can still snag a monster/rival on the
    // way back (the hit checks above run every step). No throwCount is spent; only a battle
    // capture costs a durability charge.
    if (pr.ttl <= 0) continue; // safety cap reached → despawn
    const owner = round.players.get(pr.owner);
    if (!pr.returning && (pr.dist >= pr.maxDist || !isWalkable(round.map, pr.x, pr.y))) {
      pr.returning = true;
      pr.x -= pr.vx * dt; pr.y -= pr.vy * dt; // back off the range edge / wall before homing
    }
    if (pr.returning) {
      if (!owner) continue; // thrower left the round → nothing to return to; despawn
      const dx = owner.x - pr.x, dy = owner.y - pr.y, d = Math.hypot(dx, dy) || 1;
      if (d <= GAME.SPIRIT_CHAIN.PICKUP_RADIUS) continue; // returned to the tamer → despawn
      pr.vx = (dx / d) * pr.speed; pr.vy = (dy / d) * pr.speed; // home back in
    }
    keep.push(pr);
  }
  round.projectiles = keep;
}

// Tile collision: voidMap truthy = walkable floor (DLA-carved). World coord /
// EFFECTIVE_TILE = tile index. No map yet (still loading) → permissive.
// (isWalkable now imported from engine/mapgen.js — single shared collision rule for
// the server, SP game.js, and MP movement prediction; no duplicate copies to drift.)

// The `welcome` payload (the authoritative profile snapshot the client renders). Factored so every
// sender (the join handler, etc.) emits an identical, current view.
function welcomePayload(profile) {
  return {
    id: profile.id, nickname: profile.name, isGuest: !!profile.isGuest, token: profile.token,
    team: profile.activeMonsters, vault: profile.vaultMonsters || [], stats: profile.stats || {},
    chains: profile.chains || [], equippedChainId: profile.equippedChainId || null,
    equippedChainIds: profile.equippedChainIds || [], // CHAIN_SLOTS: the 3-slot loadout
    gold: profile.gold || 0, essence: profile.essence || 0, upgrades: profile.upgrades || {},
    level: profile.level || 1, xp: profile.xp || 0, // TQ-186: account prestige level + carry-over XP
    ownedCosmetics: profile.ownedCosmetics || { chain: [], char: [] }, items: profile.items || [],
    bpSeasonId: profile.bpSeasonId || null, bpXp: profile.bpXp || 0, bpClaimed: profile.bpClaimed || [], // TQ-182: battle-pass progress
    adFree: !!profile.adFree, // TQ-174: ad-free entitlement (server-authoritative; ad rendering reads isAdFree)
    subscribed: !!profile.subscribed, // TQ-267: legacy/perpetual subscription flag (back-compat)
    subscribedUntil: profile.subscribedUntil || 0, // TQ-270: recurring-subscription expiry (epoch ms; 0 = none). Active while now < this — premium battle-pass track + status read this
  };
}

// (TQ-38 / TQ-91 Option C: the local→server import path was removed — everyone starts on the server
// profile, nothing client-supplied is merged. This also closed the TQ-80 import cheat.)

function sanitizeNick(n) {
  // SEC-A4 defense-in-depth: strip control chars + HTML angle brackets at the source.
  // A display name has no need for < or >, and nicks are attacker-controlled and render
  // in several HTML spots (leaderboard, admin live-ops) as well as the canvas. The render
  // sites escape today, but stripping here means a future un-escaped HTML render site
  // can't be turned into a stored-XSS vector (defense at the source, like the prompt sanitizer).
  const s = (typeof n === "string" ? n : "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "") // C0 control chars, DEL, and the < > tag delimiters
    .trim()
    .replace(/\s+/g, " ");
  return (s || "Tamer").slice(0, 20);
}

function clampAxis(v) {
  v = Number(v) || 0;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
