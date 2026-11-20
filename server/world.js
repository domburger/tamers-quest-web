import { randomSeed, makeRng, hashString } from "../src/engine/rng.js";
import { GAME, grantChain, finalizeRunChains, buyChain, craftUpgrade, ensureChainSlots, grantEssence } from "../src/engine/schemas.js";
import { generateMap, findSpreadSpawns, isWalkable, edgeClearX, edgeClearY, stepBody } from "../src/engine/mapgen.js";
import { getByToken, createProfile, saveProfile, rollStarters, bumpStat, newMonsterId, secureId } from "./store.js";
import { handleMarketMessage } from "./marketplace.js";
import { processEvolutions } from "./genEvolve.js";
import { saveMarketListings, saveEvolvedTypes } from "./db.js";
import { resolveCombatAction, makeEnemy, attacksFor, monSnap, restoreEnergyPartial } from "./combat.js";
import { aiEnabled } from "./ai.js";
import { getMonsterType, getSpiritChain, getSpiritChains, getItem, getItems } from "../src/engine/gamedata.js";
import { getMonsterStats, getMonsterMaxHp } from "../src/engine/stats.js";
import { grantExtractRewards, defeatGold, healTeam, grantPlayerXp, playerDefeatXp, grantBattlePassXp, battlePassDefeatXp, claimBattlePassTier, isPremiumEntitled } from "../src/engine/progression.js";
import { canThrow, rollChainDrop, clusterTargets } from "../src/engine/spiritchains.js";
import { purchaseUpgrade, getUpgradeDef } from "../src/engine/upgrades.js";
import { addCaughtMonster, applyRoster, equipChain, setChainSlots, releaseMonster, loseRunTeam } from "../src/engine/inventory.js";
import { itemCombatDescription, rollItemFromPool } from "../src/engine/items.js";
import { buySkin } from "../src/engine/cosmetics.js";
// Server imports these src/render catalogs: keep them DOM-free and import-free.
import { CHAIN_SKINS } from "../src/render/chainCosmetics.js";
import { CHARACTER_SKINS } from "../src/render/characterCosmetics.js";
import { sprintingNow, tickStamina, sprintMult } from "../src/engine/movement.js";
import { generateMonster, generateBiome, generateTile } from "./content.js";
import { allBiomes, BIOME_DEFS } from "../src/engine/mapgen.js";
import { getMonsterTypes, getGroundTiles, getEvolvedTypes } from "../src/engine/gamedata.js";
import { roundComposition, getGenConfig } from "./genConfig.js";
import { saveRoundBiomes } from "./db.js";
import { maybeStartPvp, startPvp, handlePvpAction, endPvpFor } from "./pvp.js";

const SNAPSHOT_EVERY = 1;
const MOVE_INPUT_TTL_S = 0.12;

const AOI_RADIUS = 900;
const REVEAL_RADIUS = GAME.REVEAL_RADIUS;
const HIDDEN_MONSTER_PCT = GAME.HIDDEN_MONSTER_PCT;
const ENCOUNTER_RADIUS = 44;
const AOI2 = AOI_RADIUS * AOI_RADIUS, REVEAL2 = REVEAL_RADIUS * REVEAL_RADIUS;
const monsterInAoi = (mo, px, py) => { const dx = mo.x - px, dy = mo.y - py; return dx * dx + dy * dy <= (mo.hidden ? REVEAL2 : AOI2); };
const playerInAoi = (entry, px, py, selfId) => entry[0] !== selfId && sqDist(entry[1].x, entry[1].y, px, py) <= AOI2;
const entityInAoi = (e, px, py) => sqDist(e.x, e.y, px, py) <= AOI2;

const sigPlayer = (o) => `${o.x},${o.y},${o.name || ""},${o.skinId || ""},${o.charId || ""},${o.chainTier ?? ""}`;
const sigMon = (o) => `${o.x},${o.y},${o.level ?? ""}`;
const sigProj = (o) => `${o.x},${o.y},${o.vx},${o.vy}`;
const sigChest = (o) => `${o.x},${o.y}`;
function diffView(curScratch, baseMap, viewArr, sig) {
  const cur = curScratch; cur.clear();
  const upd = [];
  for (const o of viewArr) { const s = sig(o); cur.set(o.id, s); if (baseMap.get(o.id) !== s) upd.push(o); }
  const gone = [];
  for (const k of baseMap.keys()) if (!cur.has(k)) gone.push(k);
  return { upd, gone, commit: () => { baseMap.clear(); for (const [k, s] of cur) baseMap.set(k, s); } };
}

// Must exceed the 400ms viewLagMs clamp; time-based, not tick-count.
const POS_HIST_MS = 500;
export function recordPosHistory(round, nowMs) {
  if (!round.posHist) round.posHist = [];
  round.posHist.push({ t: nowMs, mon: (round.monsters || []).map((mo) => ({ id: mo.id, x: mo.x, y: mo.y })) });
  const cutoff = nowMs - POS_HIST_MS;
  while (round.posHist.length > 2 && round.posHist[1].t <= cutoff) round.posHist.shift();
}
export function rewindMonsters(round, lagMs, nowMs) {
  const hist = round.posHist;
  if (!lagMs || !hist || hist.length < 2) return null;
  const target = nowMs - lagMs;
  const newest = hist[hist.length - 1];
  if (target >= newest.t) return null;
  if (target <= hist[0].t) return null;
  let lo = 0;
  for (let k = hist.length - 1; k >= 1; k--) { if (hist[k - 1].t <= target) { lo = k - 1; break; } }
  const a = hist[lo], b = hist[lo + 1] || a;
  const span = Math.max(1, b.t - a.t), f = Math.max(0, Math.min(1, (target - a.t) / span));
  const bById = new Map(b.mon.map((m) => [m.id, m]));
  const out = new Map();
  for (const m of a.mon) { const mb = bById.get(m.id) || m; out.set(m.id, { x: m.x + (mb.x - m.x) * f, y: m.y + (mb.y - m.y) * f }); }
  return out;
}
const ITEM_DROP_CHANCE = 0.3;
const EXTRACT_RADIUS = 48;
const STORM_DPS = GAME.STORM_DPS;
const DANGER_FILL_S = 30;
const DANGER_DRAIN_S = 10;
const DISCONNECT_GRACE_MS = 120000;

export function createWorld({
  countdownTicks = 75,
  minPlayers = 1,
  roundDurationS = GAME.ROUND_DURATION_S,
  circleStartS = GAME.CIRCLE_START_S,
  portalIntervalS = GAME.PORTAL_INTERVAL_S,
  monsterGenRate = 0,
  pvpEnabled = false,
  baseSpeed = GAME.BASE_SPEED,
  stormDps = STORM_DPS,
  dangerFillS = DANGER_FILL_S,
  dangerDrainS = DANGER_DRAIN_S,
  encounterRadius = ENCOUNTER_RADIUS,
  hiddenMonsterPct = HIDDEN_MONSTER_PCT,
  energyRestorePct = GAME.ENERGY_RESTORE_PCT,
  pvpRadius = 40,
  monsterApproachPct = 30,
  monsterApproachSpeedFrac = 0.35,
  monsterApproachRadius = 700,
  hubBroadcastEvery = 3,
} = {}) {
  return {
    cfg: {
      countdownTicks, minPlayers, roundDurationS, circleStartS, portalIntervalS, monsterGenRate, pvpEnabled,
      baseSpeed, stormDps, dangerFillS, dangerDrainS, encounterRadius, hiddenMonsterPct, energyRestorePct, pvpRadius,
      monsterApproachPct, monsterApproachSpeedFrac, monsterApproachRadius, hubBroadcastEvery,
    },
    sessions: new Map(),
    marketListings: [],
    queue: [],
    formingAtTick: null,
    rounds: new Map(),
    combats: new Map(),
    pvps: new Map(),
    tick: 0,
    nextRound: 1,
    nextCombat: 1,
    nextPvp: 1,
    recentResults: [],
    biomeOrder: [],
    biomesInitialized: false,
    roundBiomeSet: [],
  };
}

export function handleMessage(world, conn, msg, send) {
  if (!msg || typeof msg.t !== "string") return;
  switch (msg.t) {
    case "hello":
      send(conn.ws, { t: "server_info", maxPlayers: GAME.MAX_PLAYERS, serverTime: Date.now() });
      break;

    case "join": {
      if (conn.playerId) return;
      let profile = getByToken(msg.token);
      const wasFresh = !profile;
      if (!profile) profile = createProfile(sanitizeNick(msg.nickname), { isGuest: !!msg.isGuest });
      const existing = world.sessions.get(profile.id);
      conn.playerId = profile.id;
      const welcome = { t: "welcome", you: welcomePayload(profile) };

      if (existing) {
        const oldWs = existing.ws;
        existing.ws = conn.ws;
        existing.disconnected = false;
        existing.disconnectedAt = null;
        if (oldWs && oldWs !== conn.ws) {
          try { if (typeof oldWs.terminate === "function") oldWs.terminate(); else if (typeof oldWs.close === "function") oldWs.close(); } catch {}
        }
        send(conn.ws, welcome);
        const round = existing.roundId ? world.rounds.get(existing.roundId) : null;
        const rp = round?.players.get(profile.id);
        if (round && rp) resumeRound(world, existing, round, rp, send);
        else {
          existing.state = "idle"; existing.roundId = null;
          if (existing.pendingResult) { send(conn.ws, existing.pendingResult); existing.pendingResult = null; }
        }
        return;
      }

      world.sessions.set(profile.id, { profile, ws: conn.ws, state: "idle", roundId: null, fresh: wasFresh });
      send(conn.ws, welcome);
      break;
    }

    case "queue": {
      const s = world.sessions.get(conn.playerId);
      if (!s || s.state !== "idle") return;
      s.state = "queued";
      world.queue.push(conn.playerId);
      if (world.formingAtTick === null) world.formingAtTick = world.tick + world.cfg.countdownTicks;
      send(conn.ws, { t: "queued", position: world.queue.length });
      break;
    }

    case "queueSolo": {
      const s = world.sessions.get(conn.playerId);
      if (!s || s.state !== "idle") return;
      formRound(world, [conn.playerId], send, { adventure: msg.mode === "adventure" });
      break;
    }

    case "returnHome": {
      const s = world.sessions.get(conn.playerId);
      if (!s || s.state !== "in_round") return;
      const round = world.rounds.get(s.roundId);
      const rp = round?.players.get(conn.playerId);
      if (!round || !round.adventure || !rp || rp.inCombat || rp.inPvp) return;
      endRunForPlayer(world, round, conn.playerId, "returned", send);
      break;
    }

    case "leaveRun": {
      const s = world.sessions.get(conn.playerId);
      if (!s || s.state !== "in_round") return;
      const round = world.rounds.get(s.roundId);
      const rp = round?.players.get(conn.playerId);
      if (!round || !rp) return;
      if (rp.inCombat) dropCombatNoContest(world, round, rp.inCombat);
      endRunForPlayer(world, round, conn.playerId, round.adventure ? "returned" : "left", send);
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
        rp.pendingMoveAge = 0;
      } else if (msg.type === "throw" && msg.payload) {
        rp.pendingThrow = {
          dx: clampAxis(msg.payload.dx),
          dy: clampAxis(msg.payload.dy),
          chainId: String(msg.payload.chainId || ""),
          charge: Math.max(0, Math.min(1, Number(msg.payload.charge) || 0)),
        };
      }
      break;
    }

    case "hubMove": {
      const s = world.sessions.get(conn.playerId);
      if (!s || s.state !== "idle") return;
      const x = Number(msg.x), y = Number(msg.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const clamp = (v) => Math.round(Math.max(-100000, Math.min(100000, v)));
      s.hub = { x: clamp(x), y: clamp(y), at: Date.now() };
      break;
    }

    case "setEquippedChain": {
      const s = world.sessions.get(conn.playerId);
      if (!s) return;
      if (equipChain(s.profile, msg.chainId)) saveProfile(s.profile);
      break;
    }

    case "setChainSlots": {
      const s = world.sessions.get(conn.playerId);
      if (!s) return;
      if (setChainSlots(s.profile, msg.chainIds)) saveProfile(s.profile);
      break;
    }

    case "setSkin": {
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
      if (s.state !== "idle") {
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
      if (s.state !== "idle") {
        send(conn.ws, { t: "shop", ok: false, locked: true, gold: s.profile.gold || 0, essence: s.profile.essence || 0, chains: s.profile.chains || [], equippedChainId: s.profile.equippedChainId || null, equippedChainIds: s.profile.equippedChainIds || [] });
        return;
      }
      const r = craftUpgrade(s.profile, String(msg.chainId || ""), getSpiritChains());
      if (r.ok) saveProfile(s.profile);
      send(conn.ws, { t: "shop", ok: r.ok, reason: r.reason, gold: s.profile.gold || 0, essence: s.profile.essence || 0, chains: s.profile.chains || [], equippedChainId: s.profile.equippedChainId || null, equippedChainIds: s.profile.equippedChainIds || [] });
      break;
    }

    case "buyCosmetic": {
      const s = world.sessions.get(conn.playerId);
      if (!s) return;
      const prof = s.profile;
      prof.ownedCosmetics = prof.ownedCosmetics || { chain: [], char: [] };
      const kind = msg.kind === "char" ? "char" : "chain";
      const catalog = kind === "chain" ? CHAIN_SKINS : CHARACTER_SKINS;
      const skin = catalog.find((sk) => sk.id === String(msg.skinId || ""));
      // Price/balance from server catalog + stored profile only, never client values.
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
      if (s.state !== "idle") {
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
      if (typeof msg.combatId !== "string") return;
      const pvp = world.pvps.get(msg.combatId);
      if (pvp) { handlePvpAction(world, pvp, conn.playerId, msg.action || {}, send).catch((e) => console.error("[pvp] action:", e)); break; }
      const session = world.combats.get(msg.combatId);
      if (!session || session.playerId !== conn.playerId || session.roundId !== s.roundId || session.resolving) return;
      const action = msg.action || {};
      if (action.kind === "item") {
        const it = (s.profile.items || []).find((i) => i.id === action.itemId);
        if (it) { const def = it.effect ? it : (getItem(it.name) || it); action.itemDef = { name: it.name, description: itemCombatDescription(def) }; }
      }
      session.resolving = true;
      resolveCombatAction(session, action, session.rng)
        .then((res) => {
          session.resolving = false;
          if (!world.combats.has(session.combatId)) return;
          if (session.usedItem) {
            const idx = (s.profile.items || []).findIndex((i) => i.id === action.itemId);
            if (idx >= 0) s.profile.items.splice(idx, 1);
            session.usedItem = null;
            saveProfile(s.profile);
            res.items = s.profile.items;
          }
          send(conn.ws, { t: "combatUpdate", combatId: session.combatId, ...res });
          if (res.outcome) endCombat(world, session, res, send);
        })
        .catch((e) => { session.resolving = false; console.error("[combat] resolve error:", e); });
      break;
    }

    case "heal": {
      const s = world.sessions.get(conn.playerId);
      if (!s) return;
      if (s.state !== "idle") { send(conn.ws, { t: "roster", ok: false, locked: true, team: s.profile.activeMonsters || [], vault: s.profile.vaultMonsters || [] }); break; }
      healTeam(s.profile.activeMonsters);
      saveProfile(s.profile);
      send(conn.ws, { t: "roster", ok: true, team: s.profile.activeMonsters || [], vault: s.profile.vaultMonsters || [] });
      break;
    }

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

    case "marketBrowse":
    case "marketList":
    case "marketCancel":
    case "marketBuy": {
      const s = world.sessions.get(conn.playerId);
      if (!s) return;
      handleMarketMessage({
        listings: world.marketListings,
        profile: s.profile,
        getProfileByToken: (tok) => getByToken(tok),
        saveProfile,
        persist: () => { try { saveMarketListings(world.marketListings); } catch (e) { void e; } },
        newId: secureId,
        isIdle: s.state === "idle",
        collectEvolvedDefs: (listings) => {
          const seen = new Set(), defs = [];
          for (const l of (listings || [])) {
            const tn = l && l.mon && l.mon.typeName;
            if (!tn || seen.has(tn)) continue;
            const t = getMonsterType(tn);
            if (t && t.evolved) { seen.add(tn); defs.push(t); }
          }
          return defs;
        },
        recordFee: (g, e) => {
          const f = world.marketFees || (world.marketFees = { gold: 0, essence: 0, sales: 0 });
          f.gold += (g || 0); f.essence += (e || 0); f.sales += 1;
          if (e > 0) { try { console.log(`[market] house cut +${g}g +${e}e (totals: ${f.gold}g ${f.essence}e over ${f.sales} sales)`); } catch (err) { void err; } }
        },
      }, msg, send, conn.ws);
      break;
    }

    case "ping": {
      if (typeof msg.lag === "number" && conn.playerId) {
        const ps = world.sessions.get(conn.playerId);
        const pr = ps && ps.roundId ? world.rounds.get(ps.roundId)?.players.get(conn.playerId) : null;
        if (pr) pr.viewLagMs = Math.max(0, Math.min(400, msg.lag | 0));
      }
      send(conn.ws, { t: "pong", t0: msg.t0, t1: Date.now() });
      break;
    }
  }
}

export { applyRoster };

export function removePlayer(world, playerId, send = () => {}) {
  if (!playerId) return;
  const s = world.sessions.get(playerId);
  if (!s) return;
  if (s.state === "in_round") {
    const round = world.rounds.get(s.roundId);
    const rp = round?.players.get(playerId);
    if (rp?.inCombat) { dropCombatNoContest(world, round, rp.inCombat); rp.inCombat = null; }
    if (rp?.inPvp) endPvpFor(world, playerId, send);
    if (round?.projectiles) round.projectiles = round.projectiles.filter((pr) => pr.owner !== playerId);
    s.disconnected = true;
    s.disconnectedAt = Date.now();
    return;
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
  broadcastHub(world, send);
}

const HUB_STALE_MS = 4000;
const HUB_MAX_PRESENT = 24;
function broadcastHub(world, send) {
  if (world.tick % world.cfg.hubBroadcastEvery !== 0) return;
  const now = Date.now();
  const inHub = (s) => s.state === "idle" && !s.disconnected && s.hub && now - s.hub.at <= HUB_STALE_MS;
  const present = [], sockets = [];
  for (const [id, s] of world.sessions) {
    if (!inHub(s)) continue;
    const p = s.profile;
    present.push({ id, name: p?.name, x: s.hub.x, y: s.hub.y, skinId: p?.equippedSkinId || null, charId: p?.equippedCharId || null, chainTier: getSpiritChain(p?.equippedChainId)?.tier || null });
    sockets.push(s.ws);
    if (present.length >= HUB_MAX_PRESENT) break;
  }
  if (!present.length) return;
  for (let i = 0; i < present.length; i++) {
    const others = [];
    for (let j = 0; j < present.length; j++) if (j !== i) others.push(present[j]);
    send(sockets[i], { t: "hubSnapshot", players: others });
  }
}

function sweepDisconnected(world, send) {
  for (const [id, s] of world.sessions) {
    if (!s.disconnected || Date.now() - s.disconnectedAt <= DISCONNECT_GRACE_MS) continue;
    const round = s.roundId ? world.rounds.get(s.roundId) : null;
    if (round && round.players.get(id)) endRunForPlayer(world, round, id, round.adventure ? "returned" : "disconnect", send);
    world.sessions.delete(id);
  }
}

function resumeRound(world, s, round, rp, send) {
  s.snapResync = true; // Client clears its delta store on roundStart: force a full keyframe.
  const ids = [...round.players.keys()];
  send(s.ws, {
    t: "roundStart",
    roundId: round.roundId,
    seed: round.seed,
    biomes: round.biomeSet || null,
    comp: round.comp || null,
    mapSize: round.mapSize,
    spawn: { x: Math.round(rp.x), y: Math.round(rp.y) },
    you: { id: s.profile.id, nickname: s.profile.name },
    players: ids.filter((o) => o !== s.profile.id).map((o) => ({ id: o, name: world.sessions.get(o)?.profile.name })),
    durationS: GAME.ROUND_DURATION_S,
    time: Math.ceil(round.remaining ?? 0),
    circle: round.circle || null,
    portals: round.portals || [],
    chests: (round.chests || [])
      .filter((c) => sqDist(c.x, c.y, rp.x, rp.y) <= AOI_RADIUS * AOI_RADIUS)
      .map((c) => ({ id: c.id, x: c.x, y: c.y })),
    atRisk: runAtRisk(s),
    resumed: true,
  });
}

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

export function rotateBiomeOrder(prevOrder, poolNames, { total, fresh, initialized }) {
  const poolSet = new Set(poolNames);
  const order = (prevOrder || []).filter((n) => poolSet.has(n));
  for (const n of poolNames) if (!order.includes(n)) order.push(n);
  const t = Math.max(0, Math.min(total, order.length));
  if (initialized && t > 0) {
    const bench = Math.max(0, order.length - t);
    const f = Math.max(0, Math.min(fresh, bench));
    for (let i = 0; i < f; i++) order.push(order.shift());
  }
  return { order, set: order.slice(0, t) };
}

export function ensureGeneratedShare(set, order, generated, { total, minGen } = {}) {
  const isGen = (n) => generated.has(n);
  const availGen = order.filter(isGen).length;
  const want = Math.min(minGen != null ? minGen : Math.floor((total ?? set.length) / 3), availGen);
  let have = set.filter(isGen).length;
  if (have >= want) return set.slice();
  const inSet = new Set(set);
  const benched = order.filter((n) => isGen(n) && !inSet.has(n));
  const out = set.slice();
  for (let i = out.length - 1; i >= 0 && have < want && benched.length; i--) {
    if (!isGen(out[i])) { out[i] = benched.shift(); have++; }
  }
  return out;
}

function buildRoundBiomeSet(world) {
  const comp = roundComposition();
  const pool = allBiomes();
  const poolNames = pool.map((b) => b.name);
  const { order, set } = rotateBiomeOrder(world.biomeOrder, poolNames, {
    total: comp.biomesPerRound,
    fresh: comp.newBiomesPerRound,
    initialized: world.biomesInitialized,
  });
  world.biomeOrder = order;
  world.biomesInitialized = true;
  const builtin = new Set(BIOME_DEFS.map((b) => b.name));
  const genNames = new Set(poolNames.filter((n) => !builtin.has(n)));
  const shownSet = ensureGeneratedShare(set, order, genNames, { total: comp.biomesPerRound });
  world.roundBiomeSet = shownSet;
  saveRoundBiomes({ order }).catch(() => {});
  const byName = new Map(pool.map((b) => [b.name, b]));
  return shownSet.map((n) => byName.get(n)).filter(Boolean);
}

export function computeGenShortfall(comp, counts) {
  const biomeTarget = comp.biomesPerRound + comp.newBiomesPerRound;
  const biomes = Math.max(0, biomeTarget - (counts.biomes || 0));
  const monsters = Math.max(0, comp.monstersPerBiome - (counts.monsters || 0));
  const tiles = {};
  for (const [b, s] of Object.entries(counts.tileSplit || {})) {
    const collidable = Math.max(0, comp.tilesCollidablePerBiome - (s.collidable || 0));
    const walk = Math.max(0, comp.tilesNonCollidablePerBiome - (s.walk || 0));
    if (collidable || walk) tiles[b] = { collidable, walk };
  }
  return { biomes, monsters, tiles };
}

let backfilling = false;

const MAX_BIOME_GEN_PER_ROUND = 2, MAX_TILE_GEN_PER_ROUND = 4;
async function backfillRoundMaterial(world) {
  if (backfilling || !getGenConfig("roundGenBackfill")) return;
  backfilling = true;
  try {
    const comp = roundComposition();
    const setNames = world.roundBiomeSet || [];
    const tileSplit = {};
    for (const b of setNames) {
      const ts = getGroundTiles().filter((t) => t.biome === b);
      tileSplit[b] = { collidable: ts.filter((t) => t.collidable).length, walk: ts.filter((t) => !t.collidable).length };
    }
    const need = computeGenShortfall(comp, { biomes: allBiomes().length, monsters: getMonsterTypes().length, tileSplit });

    for (let i = 0; i < Math.min(need.biomes, MAX_BIOME_GEN_PER_ROUND); i++) {
      if (!(await generateBiome().catch(() => null))) break;
    }
    const tileNeeds = Object.entries(need.tiles)
      .map(([biome, s]) => ({ biome, n: s.collidable + s.walk }))
      .sort((a, b) => b.n - a.n);
    let tilesMade = 0;
    for (const { biome } of tileNeeds) {
      if (tilesMade >= MAX_TILE_GEN_PER_ROUND) break;
      if (!(await generateTile({ biome }).catch(() => null))) break;
      tilesMade++;
    }
    for (let i = 0; i < Math.min(need.monsters, comp.maxNewMonstersPerRound); i++) {
      if (!(await generateMonster().catch(() => null))) break;
    }
  } catch (e) {
    console.error("[content] round backfill:", e.message);
  } finally {
    backfilling = false;
  }
}

function formRound(world, ids, send, opts = {}) {
  const round = {
    roundId: "r" + world.nextRound++,
    seed: randomSeed(),
    phase: "loading",
    startedAtMs: Date.now(),
    players: new Map(),
    map: null,
    adventure: !!opts.adventure,
    depth: 1,
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

  generateRound(world, round, send).catch((e) => console.error("[tamers-quest] generateRound:", e));
  return round;
}

async function generateRound(world, round, send) {
  let map = null;
  const biomeSet = buildRoundBiomeSet(world);
  const comp = roundComposition();
  round.biomeSet = biomeSet;
  round.comp = comp;
  try {
    map = await generateMap(null, round.seed, biomeSet, comp);
  } catch (e) {
    console.error(`[tamers-quest] map gen failed for ${round.roundId}:`, e);
  }
  if (!world.rounds.has(round.roundId)) return;

  round.map = map;
  const spawnRng = makeRng((round.seed ^ 0x9e3779b9) >>> 0);
  const E = GAME.EFFECTIVE_TILE;

  round.monsters = monstersFromMap(world, map);

  const ids = [...round.players.keys()];
  const spawnTiles = map ? findSpreadSpawns(map.voidMap, spawnRng, ids.length, undefined, map.tileMap, map.reachMap) : null;

  for (const [idx, id] of ids.entries()) {
    const rp = round.players.get(id);
    const s = world.sessions.get(id);
    if (!rp || !s) continue;
    const tile = spawnTiles ? spawnTiles[idx] : { x: 200, y: 200 };
    rp.x = tile.x * E + E / 2;
    rp.y = tile.y * E + E / 2;
    rp.stamina = GAME.SPRINT.STAMINA_MAX;
    rp.spawned = true;
    clearSpawnArea(round, rp);
    bumpStat(s.profile, "runs");
    s.runStart = runStartSnapshot(s.profile);
    s.runVaultIds = (s.profile.vaultMonsters || []).map((m) => m.id);
    s.runItemIds = (s.profile.items || []).map((i) => i.id);
    s.runCatchCount = 0;
    send(s.ws, {
      t: "roundStart",
      roundId: round.roundId,
      seed: round.seed, // Clients regenerate the map from seed + biomes + comp; all must match exactly.
      biomes: biomeSet,
      comp,
      mapSize: map ? map.mapSize : 400,
      spawn: { x: rp.x, y: rp.y },
      you: { id, nickname: s.profile.name },
      players: ids
        .filter((o) => o !== id)
        .map((o) => ({ id: o, name: world.sessions.get(o)?.profile.name })),
      durationS: GAME.ROUND_DURATION_S,
      adventure: !!round.adventure, depth: round.depth || 1,
    });
  }
  round.mapSize = map ? map.mapSize : 400;
  round.portals = [];
  if (round.adventure) {
    const first = [...round.players.values()][0];
    const rift = first ? spawnTravelRift(map, first.x, first.y) : null;
    if (rift) round.portals = [rift];
  }
  round.projectiles = [];
  round.nextProjectile = 1;
  round.chests = spawnChests(round, map);
  round.startedAtMs = Date.now();
  round.phase = "active";

  if (world.cfg.monsterGenRate > 0 && Math.random() < world.cfg.monsterGenRate) {
    generateMonster().catch((e) => console.error("[content] generateMonster:", e.message));
  }
  backfillRoundMaterial(world).catch((e) => console.error("[content] backfill:", e.message));
}

function monstersFromMap(world, map) {
  const E = GAME.EFFECTIVE_TILE;
  return (map?.monsters || []).map((m) => ({
    id: m.id, typeName: m.typeName, level: m.level,
    x: m.tileX * E, y: m.tileY * E,
    hidden: hashString(String(m.id)) % 100 < world.cfg.hiddenMonsterPct,
    approacher: hashString("hunt:" + String(m.id)) % 100 < world.cfg.monsterApproachPct,
  }));
}

const TRAVEL_EDGE_TILES = 1.5;
function spawnTravelRift(map, fromX, fromY) {
  if (!map || !map.voidMap) return null;
  const E = GAME.EFFECTIVE_TILE, N = map.mapSize;
  let best = null, bd = -1;
  for (let tx = 2; tx < N - 2; tx += 3) {
    for (let ty = 2; ty < N - 2; ty += 3) {
      if (!map.voidMap[tx]?.[ty]) continue;
      if (map.tileMap && (!map.tileMap[tx]?.[ty] || map.tileMap[tx][ty].collidable)) continue;
      if (map.reachMap && !map.reachMap[tx]?.[ty]) continue;
      const px = tx * E + E / 2, py = ty * E + E / 2;
      const d = (px - fromX) ** 2 + (py - fromY) ** 2;
      if (d > bd) { bd = d; best = { x: Math.round(px), y: Math.round(py) }; }
    }
  }
  return best;
}
async function travelRegion(world, round, exitId, send) {
  if (round.phase !== "active") return;
  round.phase = "loading";
  const E = GAME.EFFECTIVE_TILE;
  const exit = round.players.get(exitId);
  const oldExtent = round.mapSize * E;
  const mirror = exit ? { x: oldExtent - exit.x, y: oldExtent - exit.y } : null;
  round.seed = randomSeed();
  round.biomeSet = buildRoundBiomeSet(world);
  round.comp = roundComposition();
  let map = null;
  try { map = await generateMap(null, round.seed, round.biomeSet, round.comp); }
  catch (e) { console.error(`[tamers-quest] region gen failed for ${round.roundId}:`, e); }
  if (!world.rounds.has(round.roundId)) return;
  round.map = map;
  round.mapSize = map ? map.mapSize : 400;
  round.depth = (round.depth || 1) + 1;
  round.monsters = monstersFromMap(world, map).map((m) => ({ ...m, level: Math.min(50, m.level + (round.depth - 1)) }));
  round.portals = [];
  round.projectiles = [];
  round.chests = spawnChests(round, map);
  const spawnRng = makeRng((round.seed ^ 0x9e3779b9) >>> 0);
  const cands = map ? findSpreadSpawns(map.voidMap, spawnRng, 12, 8, map.tileMap, map.reachMap) : [{ x: 200, y: 200 }];
  for (const [id, rp] of round.players) {
    const s = world.sessions.get(id);
    if (!s) continue;
    let best = cands[0];
    if (mirror) { let bd = Infinity; for (const c of cands) { const d = (c.x * E + E / 2 - mirror.x) ** 2 + (c.y * E + E / 2 - mirror.y) ** 2; if (d < bd) { bd = d; best = c; } } }
    rp.x = best.x * E + E / 2; rp.y = best.y * E + E / 2;
    clearSpawnArea(round, rp);
    rp.pendingMove = null; rp.pendingThrow = null; rp.danger = 0;
    send(s.ws, {
      t: "roundStart",
      roundId: round.roundId,
      seed: round.seed, biomes: round.biomeSet, comp: round.comp,
      mapSize: round.mapSize,
      spawn: { x: rp.x, y: rp.y },
      you: { id, nickname: s.profile.name },
      players: [...round.players.keys()].filter((o) => o !== id).map((o) => ({ id: o, name: world.sessions.get(o)?.profile.name })),
      durationS: GAME.ROUND_DURATION_S,
      adventure: true, depth: round.depth, travelled: true,
    });
  }
  const first = [...round.players.values()][0];
  const rift = first ? spawnTravelRift(map, first.x, first.y) : null;
  round.portals = rift ? [rift] : [];
  round.phase = "active";
}

function tickMonsterApproach(world, round, dt) {
  const monsters = round.monsters || [];
  if (!monsters.length || world.cfg.monsterApproachPct <= 0) return;
  const targets = [], nowApp0 = Date.now();
  for (const rp of round.players.values()) if (rp.spawned && !rp.inCombat && !rp.inPvp && !(rp.encounterGraceUntil && rp.encounterGraceUntil > nowApp0)) targets.push(rp);
  if (!targets.length) return;
  const aggro2 = world.cfg.monsterApproachRadius * world.cfg.monsterApproachRadius;
  const v = world.cfg.baseSpeed * world.cfg.monsterApproachSpeedFrac;
  const maxXY = Math.max(0, (round.mapSize - 1) * GAME.EFFECTIVE_TILE);
  const R = GAME.PLAYER_RADIUS;
  const nowApp = Date.now();
  for (const mo of monsters) {
    if (!mo.approacher || mo.hidden) continue;
    if (mo.fleeUntil && mo.fleeUntil > nowApp) continue;
    let best = null, bd2 = Infinity;
    for (const rp of targets) { const dx = rp.x - mo.x, dy = rp.y - mo.y, d2 = dx * dx + dy * dy; if (d2 < bd2) { bd2 = d2; best = rp; } }
    if (!best || bd2 > aggro2) continue;
    const len = Math.sqrt(bd2) || 1;
    const ux = (best.x - mo.x) / len, uy = (best.y - mo.y) / len;
    const nx = Math.min(maxXY, Math.max(0, mo.x + ux * v * dt));
    const ny = Math.min(maxXY, Math.max(0, mo.y + uy * v * dt));
    if (edgeClearX(round.map, nx + Math.sign(ux) * R, mo.y, R)) mo.x = nx;
    if (edgeClearY(round.map, mo.x, ny + Math.sign(uy) * R, R)) mo.y = ny;
  }
}

function tickRound(world, round, dt, send) {
  if (round.phase !== "active") return;
  const speed = world.cfg.baseSpeed;
  const maxXY = Math.max(0, (round.mapSize - 1) * GAME.EFFECTIVE_TILE);
  for (const rp of round.players.values()) {
    const locked = rp.inCombat || rp.inPvp;
    if (locked) rp.pendingMove = null;
    const pm = rp.pendingMove;
    if (pm) rp.pendingMoveAge = (rp.pendingMoveAge || 0) + dt;
    const moving = !locked && !!pm && rp.pendingMoveAge <= MOVE_INPUT_TTL_S && (pm.dx !== 0 || pm.dy !== 0);
    if (rp.stamina == null) rp.stamina = GAME.SPRINT.STAMINA_MAX;
    const sprinting = moving && sprintingNow({ sprint: pm.sprint, moving, stamina: rp.stamina, wasSprinting: rp.wasSprinting }, GAME);
    rp.stamina = tickStamina(rp.stamina, sprinting, dt, GAME);
    rp.wasSprinting = sprinting;
    if (!moving) continue;
    let { dx, dy } = pm;
    if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }
    const v = speed * sprintMult(sprinting, GAME);
    const R = GAME.PLAYER_RADIUS;
    const st = stepBody(round.map, rp.x, rp.y, dx, dy, v * dt, R, maxXY);
    rp.x = st.x; rp.y = st.y;
    if (round.adventure) {
      const edge = TRAVEL_EDGE_TILES * GAME.EFFECTIVE_TILE;
      if (rp.x <= edge || rp.y <= edge || rp.x >= maxXY - edge || rp.y >= maxXY - edge) {
        const exitId = [...round.players.entries()].find(([, v]) => v === rp)?.[0];
        travelRegion(world, round, exitId, send).catch((e) => console.error("[tamers-quest] travelRegion:", e));
        return;
      }
    }
    // Don't clear pendingMove: it persists until next input/TTL (else rubberband).
  }

  processChests(world, round, send);

  processThrows(world, round);
  stepProjectiles(world, round, dt, send);

  tickMonsterApproach(world, round, dt);

  const ER2 = world.cfg.encounterRadius * world.cfg.encounterRadius, nowEnc = Date.now();
  recordPosHistory(round, nowEnc);
  for (const [id, rp] of round.players) {
    if (rp.inCombat || rp.inPvp) continue;
    if (rp.encounterGraceUntil && rp.encounterGraceUntil > nowEnc) continue;
    const rew = rewindMonsters(round, rp.viewLagMs, nowEnc);
    // Re-read round.monsters each iteration: startCombat removes engaged monsters.
    const entry = (round.monsters || []).find((mo) => {
      if (mo.fleeUntil && mo.fleeUntil > nowEnc) return false;
      const p = (rew && rew.get(mo.id)) || mo;
      const dx = p.x - rp.x, dy = p.y - rp.y;
      return dx * dx + dy * dy <= ER2;
    });
    if (entry) startCombat(world, round, id, entry, send);
  }

  if (world.cfg.pvpEnabled) maybeStartPvp(world, round, send);

  updateExtraction(world, round, dt, send);

  if (world.tick % SNAPSHOT_EVERY !== 0) return;
  const scr = world._snapCur || (world._snapCur = { players: new Map(), monsters: new Map(), projectiles: new Map(), chests: new Map() });
  const sv = world._snapView || (world._snapView = { players: [], monsters: [], projectiles: [], chests: [] });
  const all = [...round.players.entries()];
  const monsters = round.monsters || [];
  const projectiles = round.projectiles || [];
  const chests = round.chests || [];
  const monstersView = monsters.map((mo) => ({ id: mo.id, typeName: mo.typeName, level: mo.level, x: Math.round(mo.x), y: Math.round(mo.y) }));
  const playersView = all.map(([oid, orp]) => {
    const op = world.sessions.get(oid)?.profile;
    return { id: oid, name: op?.name, x: Math.round(orp.x), y: Math.round(orp.y), skinId: op?.equippedSkinId || null, charId: op?.equippedCharId || null, chainTier: getSpiritChain(op?.equippedChainId)?.tier || null };
  });
  const projectilesView = projectiles.map((pr) => ({ id: pr.id, owner: pr.owner, x: Math.round(pr.x), y: Math.round(pr.y), vx: pr.vx, vy: pr.vy, chainId: pr.chainId }));
  const chestsView = chests.map((c) => ({ id: c.id, x: c.x, y: c.y }));
  for (const [id, rp] of all) {
    const s = world.sessions.get(id);
    if (!s) continue;
    if (!s.snapBase || s.snapBaseRound !== round.roundId || s.snapResync) {
      s.snapBase = { players: new Map(), monsters: new Map(), projectiles: new Map(), chests: new Map() };
      s.snapBaseRound = round.roundId;
      s.snapResync = false;
      s.snapYouSig = null;
    }
    const base = s.snapBase;
    const viewP = filterRefs(sv.players, all, playersView, playerInAoi, rp.x, rp.y, id);
    const viewM = filterRefs(sv.monsters, monsters, monstersView, monsterInAoi, rp.x, rp.y);
    const viewPr = filterRefs(sv.projectiles, projectiles, projectilesView, entityInAoi, rp.x, rp.y);
    const viewCh = filterRefs(sv.chests, chests, chestsView, entityInAoi, rp.x, rp.y);
    const full = base.players.size === 0 && base.monsters.size === 0 && base.projectiles.size === 0 && base.chests.size === 0;
    const dP = diffView(scr.players, base.players, viewP, sigPlayer);
    const dM = diffView(scr.monsters, base.monsters, viewM, sigMon);
    const dPr = diffView(scr.projectiles, base.projectiles, viewPr, sigProj);
    const dCh = diffView(scr.chests, base.chests, viewCh, sigChest);
    const msg = {
      t: "snapshot",
      tick: world.tick,
      roundId: round.roundId,
      full,
      you: { id, x: Math.round(rp.x), y: Math.round(rp.y), ack: rp.lastSeq, stamina: Math.round(rp.stamina ?? GAME.SPRINT.STAMINA_MAX), danger: Math.round((rp.danger || 0) * 1000) / 1000 },
      time: Math.ceil(round.remaining ?? 0),
      circle: round.circle || null,
      portals: round.portals || [],
    };
    if (dP.upd.length) msg.players = dP.upd; if (dP.gone.length) msg.pGone = dP.gone;
    if (dM.upd.length) msg.monsters = dM.upd; if (dM.gone.length) msg.mGone = dM.gone;
    if (dPr.upd.length) msg.projectiles = dPr.upd; if (dPr.gone.length) msg.prGone = dPr.gone;
    if (dCh.upd.length) msg.chests = dCh.upd; if (dCh.gone.length) msg.chGone = dCh.gone;
    const youMeta = { team: teamHp(s.profile), chains: chainsView(s.profile), equippedChainId: s.profile.equippedChainId || null, equippedChainIds: s.profile.equippedChainIds || [], gold: s.profile.gold || 0, essence: s.profile.essence || 0, upgrades: s.profile.upgrades || {} };
    const youSig = JSON.stringify(youMeta);
    const youChanged = youSig !== s.snapYouSig;
    if (youChanged) msg.youMeta = youMeta;
    // Commit baselines only if the frame was sent (shed frames must re-diff).
    if (send(s.ws, msg) !== false) { dP.commit(); dM.commit(); dPr.commit(); dCh.commit(); if (youChanged) s.snapYouSig = youSig; }
  }
}

function updateExtraction(world, round, dt, send) {
  const cfg = world.cfg;
  const E = GAME.EFFECTIVE_TILE;
  if (round.adventure) {
    round.remaining = 0; round.circleRadius = 0; round.circle = null;
    for (const [id, rp] of round.players) {
      if (rp.inCombat || rp.inPvp) continue;
      if (round.portals.some((pt) => sqDist(pt.x, pt.y, rp.x, rp.y) <= EXTRACT_RADIUS * EXTRACT_RADIUS)) {
        travelRegion(world, round, id, send).catch((e) => console.error("[tamers-quest] travelRegion:", e));
        return;
      }
    }
    return;
  }
  const elapsed = (Date.now() - round.startedAtMs) / 1000;
  round.remaining = Math.max(0, cfg.roundDurationS - elapsed);

  const mapExtent = round.mapSize * E;
  if (round.zoneCx === undefined) {
    const zr = makeRng((round.seed ^ 0x5a4f4e45) >>> 0);
    const half = mapExtent / 2;
    const margin = half * 0.5;
    round.zoneCx = half + (zr.next() * 2 - 1) * margin;
    round.zoneCy = half + (zr.next() * 2 - 1) * margin;
    round.zoneStartR = Math.max(
      Math.hypot(round.zoneCx, round.zoneCy),
      Math.hypot(mapExtent - round.zoneCx, round.zoneCy),
      Math.hypot(round.zoneCx, mapExtent - round.zoneCy),
      Math.hypot(mapExtent - round.zoneCx, mapExtent - round.zoneCy),
    );
  }
  const cx = round.zoneCx, cy = round.zoneCy;
  if (elapsed >= cfg.circleStartS) {
    const span = Math.max(1, cfg.roundDurationS - cfg.circleStartS);
    round.circleRadius = Math.max(0, (round.remaining / span) * round.zoneStartR);
    round.circle = { x: Math.round(cx), y: Math.round(cy), r: Math.round(round.circleRadius) };
  } else {
    round.circleRadius = 0;
    round.circle = null;
  }

  if (elapsed >= cfg.circleStartS && round.map) {
    const want = Math.floor((elapsed - cfg.circleStartS) / cfg.portalIntervalS) + 1;
    while (round.portals.length < want) {
      if (!spawnPortal(round, cx, cy)) break;
    }
  }

  for (const [id, rp] of [...round.players]) {
    const s = world.sessions.get(id);
    if (!s) continue;
    if (round.portals.some((p) => sqDist(p.x, p.y, rp.x, rp.y) <= EXTRACT_RADIUS * EXTRACT_RADIUS)) {
      endRunForPlayer(world, round, id, "extracted", send);
      continue;
    }
    if (round.remaining <= 0) { endRunForPlayer(world, round, id, "timeout", send); continue; }
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
  const rng = round.portalRng || (round.portalRng = makeRng((round.seed ^ 0x50525400) >>> 0));
  const quad = round.portals.length % 4;
  for (let i = 0; i < 200; i++) {
    const inQuad = i < 150;
    const ang = inQuad ? quad * (Math.PI / 2) + rng.next() * (Math.PI / 2) : rng.next() * Math.PI * 2;
    const spawnR = Math.min(round.circleRadius, (round.mapSize / 2) * E);
    const dist = (inQuad ? 0.3 + rng.next() * 0.55 : rng.next() * 0.85) * spawnR;
    const tx = Math.floor((cx + Math.cos(ang) * dist) / E);
    const ty = Math.floor((cy + Math.sin(ang) * dist) / E);
    if (tx >= 0 && tx < round.mapSize && ty >= 0 && ty < round.mapSize && map.voidMap[tx]?.[ty]) {
      round.portals.push({ x: tx * E, y: ty * E });
      return true;
    }
  }
  return false;
}

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

function dropCombatNoContest(world, round, combatId) {
  const cs = combatId && world.combats.get(combatId);
  if (cs && round?.monsters) {
    if (cs.monsterEntry) round.monsters.push(cs.monsterEntry);
    for (const e of cs.queue || []) round.monsters.push(e);
  }
  if (combatId) world.combats.delete(combatId);
}

export function dropRunVaultCatches(prof, runVaultIds) {
  if (!Array.isArray(runVaultIds) || !Array.isArray(prof.vaultMonsters)) return 0;
  const keep = new Set(runVaultIds);
  const before = prof.vaultMonsters.length;
  prof.vaultMonsters = prof.vaultMonsters.filter((m) => keep.has(m.id));
  return before - prof.vaultMonsters.length;
}

export function dropRunItems(prof, runItemIds) {
  if (!Array.isArray(runItemIds) || !Array.isArray(prof.items)) return 0;
  const keep = new Set(runItemIds);
  const before = prof.items.length;
  prof.items = prof.items.filter((i) => keep.has(i.id));
  return before - prof.items.length;
}

export function runAtRisk(s) {
  const keep = new Set(s.runItemIds || []);
  return { catches: s.runCatchCount || 0, items: s.runItemIds ? (s.profile.items || []).filter((i) => !keep.has(i.id)).length : 0 };
}
function sendAtRisk(s, send) { if (s && s.ws && !s.disconnected) send(s.ws, { t: "atRisk", ...runAtRisk(s) }); }

function endRunForPlayer(world, round, id, reason, send) {
  const s = world.sessions.get(id);
  const rp = round.players.get(id);
  if (rp?.inCombat) dropCombatNoContest(world, round, rp.inCombat);
  if (rp?.inPvp) endPvpFor(world, id, send);
  round.players.delete(id);
  world.recentResults.push({ name: s?.profile?.name || "?", reason, at: Date.now() });
  if (world.recentResults.length > 30) world.recentResults.shift();
  broadcastToRound(world, round, { t: "killfeed", victim: s?.profile?.name || "?", cause: reason, at: Date.now() }, send);
  if (s) {
    s.state = "idle";
    s.roundId = null;
    const gains = computeRunGains(s); // Must run before loseRunTeam replaces the team.
    s.runStart = null;
    let term;
    if (reason === "returned") {
      finalizeRunChains(s.profile, true, getSpiritChain);
      logRun(s.profile, "returned", reason, gains);
      saveProfile(s.profile);
      term = { t: "extracted", reason, team: s.profile.activeMonsters, stats: s.profile.stats, gains, profile: welcomePayload(s.profile) };
    } else if (reason === "fainted") {
      const prof = s.profile;
      finalizeRunChains(prof, true, getSpiritChain);
      logRun(prof, "fainted", reason, gains);
      saveProfile(prof);
      term = { t: "died", reason, team: prof.activeMonsters, stats: prof.stats, gains, profile: welcomePayload(prof) };
    } else if (reason === "extracted") {
      grantExtractRewards(s.profile);
      finalizeRunChains(s.profile, true, getSpiritChain);
      bumpStat(s.profile, "extractions");
      logRun(s.profile, "extracted", reason, gains);
      saveProfile(s.profile);
      term = { t: "extracted", reason, team: s.profile.activeMonsters, stats: s.profile.stats, gains, profile: welcomePayload(s.profile) };
    } else {
      const prof = s.profile;
      bumpStat(prof, "deaths");
      logRun(prof, "died", reason, gains);
      const lostCatches = dropRunVaultCatches(prof, s.runVaultIds);
      const lostItems = dropRunItems(prof, s.runItemIds);
      loseRunTeam(prof, rollStarters);
      finalizeRunChains(prof, false, getSpiritChain);
      saveProfile(prof);
      term = { t: "died", reason, team: prof.activeMonsters, stats: prof.stats, gains, lostCatches, lostItems, profile: welcomePayload(prof) };
    }
    s.runVaultIds = null; s.runItemIds = null; s.runCatchCount = 0;
    if (s.disconnected) s.pendingResult = term; else send(s.ws, term);
    if (reason === "extracted" && !s.disconnected) triggerEvolutions(s, send).catch(() => {});
  }
  if (round.players.size === 0) world.rounds.delete(round.roundId);
}

async function triggerEvolutions(s, send) {
  try {
    const events = await processEvolutions(s.profile.activeMonsters, { newId: secureId });
    if (!events.length) return;
    saveProfile(s.profile);
    try { await saveEvolvedTypes(getEvolvedTypes()); } catch (e) { void e; }
    const types = events.map((e) => getMonsterType(e.typeName)).filter(Boolean);
    if (!s.disconnected) send(s.ws, { t: "evolved", events, types, team: s.profile.activeMonsters });
  } catch (e) { void e; }
}

export function broadcastToRound(world, round, msg, send) {
  if (!round) return;
  for (const pid of round.players.keys()) {
    const sess = world.sessions.get(pid);
    if (sess && sess.ws) send(sess.ws, msg);
  }
}

function teamHp(profile) {
  return (profile.activeMonsters || []).map((m) => {
    const mt = getMonsterType(m.typeName);
    const max = mt ? getMonsterMaxHp(mt, m.level) : Math.round(m.currentHealth) || 1;
    return { hp: Math.max(0, Math.round(m.currentHealth)), max };
  });
}

function chainsView(profile) {
  return (profile.chains || []).map((c) => {
    const v = { chainId: c.chainId, throwCount: c.throwCount, durability: c.durability };
    if (c.runFound) v.runFound = true;
    return v;
  });
}


function sqDist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

function filterRefs(out, src, view, pred, px, py, selfId) {
  out.length = 0;
  for (let i = 0; i < src.length; i++) if (pred(src[i], px, py, selfId)) out.push(view[i]);
  return out;
}

function startCombat(world, round, playerId, entry, send, opts = {}) {
  const s = world.sessions.get(playerId);
  if (!s) return;
  const team = s.profile.activeMonsters || [];
  const activeIdx = team.findIndex((m) => m.currentHealth > 0);
  if (activeIdx < 0) return;
  const rp = round.players.get(playerId);
  if (!rp || rp.inCombat || rp.inPvp) return;

  if (!aiEnabled()) {
    const now = Date.now();
    if (!rp._aiWarnAt || now - rp._aiWarnAt > 8000) {
      rp._aiWarnAt = now;
      send(s.ws, { t: "combatUnavailable", reason: "The combat judge is offline — combat needs a connection." });
    }
    return;
  }

  for (const m of team) if (m.currentHealth > 0) restoreEnergyPartial(m, world.cfg.energyRestorePct);

  // Remove from map only after the guards above, or a failed start strands them.
  const queue = opts.queue || [];
  round.monsters = round.monsters.filter((m) => m !== entry && !queue.includes(m));
  const enemy = makeEnemy(entry);
  const combatId = secureId("c"); world.nextCombat++;
  world.combats.set(combatId, {
    combatId, playerId, roundId: round.roundId,
    team, activeIdx, enemy, monsterEntry: entry, rng: makeRng(randomSeed()),
    initiator: opts.initiator === "player" ? "player" : "enemy",
    chainId: opts.chainId || s.profile.equippedChainId || null,
    queue,
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

function endCombat(world, session, res, send) {
  const s = world.sessions.get(session.playerId);
  if (!s) { world.combats.delete(session.combatId); return; }
  const round = world.rounds.get(session.roundId);
  const rp = round?.players.get(session.playerId);
  if (rp) rp.inCombat = null;

  let caughtPlacement = null;
  if (res.outcome === "caught") {
    const e = session.enemy;
    const cs = getMonsterStats(getMonsterType(e.typeName), e.level);
    const caught = {
      id: newMonsterId(),
      typeName: e.typeName, name: e.typeName, level: e.level, xp: 0,
      currentHealth: Math.max(1, Math.round(cs.health * GAME.CATCH_HEAL_FRACTION)),
      currentEnergy: Math.round(cs.energy * GAME.CATCH_HEAL_FRACTION), status: null,
    };
    const prof = s.profile;
    caughtPlacement = addCaughtMonster(prof, caught);
    if (caughtPlacement !== "released") { bumpStat(prof, "caught"); s.runCatchCount = (s.runCatchCount || 0) + 1; sendAtRisk(s, send); }
    consumeChainCharge(prof, session.chainId);
  } else if (res.outcome === "won") {
    s.profile.gold = (s.profile.gold || 0) + defeatGold(s.profile, session.enemy?.level || 1);
    grantPlayerXp(s.profile, playerDefeatXp(session.enemy?.level || 1));
    grantBattlePassXp(s.profile, battlePassDefeatXp(session.enemy?.level || 1));
  } else if (res.outcome === "fled" && round && session.monsterEntry) {
    const me = session.monsterEntry;
    if (rp && round.map) {
      const push = world.cfg.encounterRadius * 2.6;
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2, nx = rp.x + Math.cos(a) * push, ny = rp.y + Math.sin(a) * push;
        if (isWalkable(round.map, nx, ny)) { me.x = nx; me.y = ny; break; }
      }
    }
    me.fleeUntil = Date.now() + 4000;
    round.monsters.push(me);
  }

  const cont = res.outcome === "won" || res.outcome === "caught";
  const queue = session.queue || [];
  if (!cont && round) for (const e of queue) round.monsters.push(e);

  if (res.outcome === "lost") {
    world.combats.delete(session.combatId);
    if (round) endRunForPlayer(world, round, session.playerId, round.adventure ? "fainted" : "defeat", send);
    return;
  }

  for (const m of s.profile.activeMonsters || []) m.status = null;
  saveProfile(s.profile);
  world.combats.delete(session.combatId);
  send(s.ws, {
    t: "combatEnd",
    combatId: session.combatId,
    outcome: res.outcome,
    caughtPlacement,
    gains: res.gains || null,
    caught: res.caught || null,
    team: s.profile.activeMonsters,
    queued: cont && queue.length > 0,
  });

  if (cont && rp && queue.length && (s.profile.activeMonsters || []).some((m) => m.currentHealth > 0)) {
    const next = queue.shift();
    startCombat(world, round, session.playerId, next, send, { initiator: "player", chainId: session.chainId, queue });
  } else if (rp) {
    rp.encounterGraceUntil = Date.now() + ENCOUNTER_GRACE_MS;
  }
}
const ENCOUNTER_GRACE_MS = 3000;
const SPAWN_CLEAR_TILES = 4;
export function clearSpawnArea(round, rp, now = Date.now()) {
  const R = SPAWN_CLEAR_TILES * GAME.EFFECTIVE_TILE, R2 = R * R;
  if (round.monsters) round.monsters = round.monsters.filter((mo) => ((mo.x - rp.x) ** 2 + (mo.y - rp.y) ** 2) > R2);
  rp.encounterGraceUntil = now + ENCOUNTER_GRACE_MS;
}

function consumeChainCharge(profile, chainId) {
  if (!chainId) return;
  const chains = profile.chains || [];
  const cs = chains.find((c) => c.chainId === chainId);
  if (!cs) return;
  cs.durability -= 1;
  if (cs.durability <= 0) {
    chains.splice(chains.indexOf(cs), 1);
    profile.equippedChainIds = (profile.equippedChainIds || []).filter((id) => id !== chainId);
    ensureChainSlots(profile);
  }
}

function spawnChests(round, map) {
  const out = [];
  if (!map?.voidMap) return out;
  const E = GAME.EFFECTIVE_TILE, N = round.mapSize;
  const defs = getSpiritChains();
  const rng = makeRng((round.seed ^ 0x517cc1b7) >>> 0);
  const wall = (x, y) => x < 0 || x >= N || y < 0 || y >= N || !map.voidMap[x]?.[y] || map.tileMap?.[x]?.[y]?.collidable;
  const againstWall = (x, y) => wall(x - 1, y) || wall(x + 1, y) || wall(x, y - 1) || wall(x, y + 1);
  for (let i = 0; i < GAME.SPIRIT_CHAIN.CHESTS_PER_RUN; i++) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const tx = Math.floor(rng.next() * N), ty = Math.floor(rng.next() * N);
      if (wall(tx, ty) || !againstWall(tx, ty)) continue;
      const count = rng.next() < 0.35 ? 2 : 1;
      const loot = [];
      for (let n = 0; n < count; n++) { const d = rollChainDrop(defs, rng); if (d) loot.push(d.id); }
      const pool = getItems();
      const item = pool.length && rng.next() < ITEM_DROP_CHANCE ? rollItemFromPool(pool, rng.next()).name : null;
      if (loot.length || item) out.push({ id: `ch${i}`, x: tx * E + E / 2, y: ty * E + E / 2, loot, item });
      break;
    }
  }
  return out;
}

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
      if (chest.item) {
        const def = getItem(chest.item);
        if (def) {
          s.profile.items = (s.profile.items || []);
          if (s.profile.items.length < GAME.ITEM_BAG_SIZE) {
            s.profile.items.push({ id: newMonsterId(), name: def.name, description: def.description, category: def.category, rarity: def.rarity, effect: def.effect, ...(def.html ? { html: def.html } : {}) });
          } else if (s.ws) {
            send(s.ws, { t: "lootNotice", text: `Bag full — left ${def.name} behind` });
          }
        }
      }
      if (chest.item) sendAtRisk(s, send);
      saveProfile(s.profile);
    }
    round.chests.splice(idx, 1);
  }
}

function processThrows(world, round) {
  for (const [id, rp] of round.players) {
    if (!rp.pendingThrow) continue;
    const pt = rp.pendingThrow;
    rp.pendingThrow = null;
    if (rp.inCombat || rp.inPvp) continue;
    if (round.projectiles.some((pr) => pr.owner === id)) continue;
    const s = world.sessions.get(id);
    if (!s) continue;
    const chainId = pt.chainId || s.profile.equippedChainId;
    const cs = (s.profile.chains || []).find((c) => c.chainId === chainId);
    const def = cs && getSpiritChain(cs.chainId);
    if (!def || !canThrow(cs)) continue;
    const len = Math.hypot(pt.dx, pt.dy) || 1;
    const SC = GAME.SPIRIT_CHAIN, charge = Math.max(0, Math.min(1, pt.charge || 0));
    const rangeMult = 1 + SC.CHARGE_RANGE_BONUS * charge;
    const speed = def.throwSpeed * (1 + SC.CHARGE_SPEED_BONUS * charge);
    round.projectiles.push({
      id: "pr" + round.nextProjectile++,
      owner: id,
      x: rp.x, y: rp.y,
      vx: (pt.dx / len) * speed,
      vy: (pt.dy / len) * speed,
      dist: 0, maxDist: def.throwRange * rangeMult, ttl: SC.PROJECTILE_TTL_S * rangeMult,
      chainId: def.id, speed,
    });
  }
}

function stepProjectiles(world, round, dt, send) {
  if (!round.projectiles || round.projectiles.length === 0) return;
  const HR2 = GAME.SPIRIT_CHAIN.HIT_RADIUS * GAME.SPIRIT_CHAIN.HIT_RADIUS;
  const keep = [];
  for (const pr of round.projectiles) {
    pr.x += pr.vx * dt; pr.y += pr.vy * dt;
    pr.dist += pr.speed * dt; pr.ttl -= dt;

    const mon = (round.monsters || []).find((mo) => sqDist(mo.x, mo.y, pr.x, pr.y) <= HR2);
    if (mon) {
      const def = getSpiritChain(pr.chainId);
      let queue = [];
      if (def?.special === "multi") {
        queue = clusterTargets(mon, (round.monsters || []).filter((m) => m !== mon),
          GAME.SPIRIT_CHAIN.MULTI_CHAIN_RADIUS, GAME.SPIRIT_CHAIN.MULTI_MAX_TARGETS - 1);
      }
      startCombat(world, round, pr.owner, mon, send, { initiator: "player", chainId: pr.chainId, queue });
      continue;
    }

    if (world.cfg.pvpEnabled) {
      let hitPid = null;
      for (const [oid, orp] of round.players) {
        if (oid === pr.owner || orp.inCombat || orp.inPvp) continue;
        if (sqDist(orp.x, orp.y, pr.x, pr.y) <= HR2) { hitPid = oid; break; }
      }
      if (hitPid) { startPvp(world, round, pr.owner, hitPid, send, pr.owner); continue; }
    }

    if (pr.ttl <= 0) continue;
    const owner = round.players.get(pr.owner);
    if (!pr.returning && (pr.dist >= pr.maxDist || !isWalkable(round.map, pr.x, pr.y))) {
      pr.returning = true;
      pr.x -= pr.vx * dt; pr.y -= pr.vy * dt;
    }
    if (pr.returning) {
      if (!owner) continue;
      const dx = owner.x - pr.x, dy = owner.y - pr.y, d = Math.hypot(dx, dy) || 1;
      if (d <= GAME.SPIRIT_CHAIN.PICKUP_RADIUS) continue;
      pr.vx = (dx / d) * pr.speed; pr.vy = (dy / d) * pr.speed;
    }
    keep.push(pr);
  }
  round.projectiles = keep;
}

// /api/monstertypes excludes evolved types: client needs these defs to render.
function ownedEvolvedTypes(profile) {
  const seen = new Set(), out = [];
  for (const m of [...(profile.activeMonsters || []), ...(profile.vaultMonsters || [])]) {
    if (!m || !m.typeName || seen.has(m.typeName)) continue;
    const t = getMonsterType(m.typeName);
    if (t && t.evolved) { seen.add(m.typeName); out.push(t); }
  }
  return out;
}

function welcomePayload(profile) {
  return {
    id: profile.id, nickname: profile.name, isGuest: !!profile.isGuest, token: profile.token,
    team: profile.activeMonsters, vault: profile.vaultMonsters || [], stats: profile.stats || {},
    evolvedTypes: ownedEvolvedTypes(profile),
    chains: profile.chains || [], equippedChainId: profile.equippedChainId || null,
    equippedChainIds: profile.equippedChainIds || [],
    gold: profile.gold || 0, essence: profile.essence || 0, upgrades: profile.upgrades || {},
    level: profile.level || 1, xp: profile.xp || 0,
    ownedCosmetics: profile.ownedCosmetics || { chain: [], char: [] }, items: profile.items || [],
    bpSeasonId: profile.bpSeasonId || null, bpXp: profile.bpXp || 0, bpClaimed: profile.bpClaimed || [],
    adFree: !!profile.adFree,
    subscribed: !!profile.subscribed,
    subscribedUntil: profile.subscribedUntil || 0,
  };
}

function sanitizeNick(n) {
  // Strip <> and control chars: nicks render in HTML (stored-XSS defense).
  const s = (typeof n === "string" ? n : "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .trim()
    .replace(/\s+/g, " ");
  return (s || "Tamer").slice(0, 20);
}

function clampAxis(v) {
  v = Number(v) || 0;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
