// Authoritative world: sessions + lobby/matchmaking + concurrent rounds + tick.
// Imports the shared engine so client and server run identical rules.
// Flow: join (session) → queue → matchmaker forms a round (≤16, fresh seed) →
// roundStart → in-round movement/snapshots. Combat (P3), seeded-map spawns (P2),
// and DB persistence (P1-T2) plug in later behind the existing seams.

import { randomSeed, makeRng, hashString } from "../src/engine/rng.js";
import { GAME, grantChain, finalizeRunChains, buyChain, craftUpgrade } from "../src/engine/schemas.js";
import { generateMap, findSpreadSpawns, biomeSpeedMultAt } from "../src/engine/mapgen.js";
import { getByToken, createProfile, saveProfile, rollStarters, bumpStat, newMonsterId } from "./store.js";
import { resolveCombatAction, makeEnemy, attacksFor, monSnap, restoreEnergyPartial } from "./combat.js";
import { getMonsterType, getSpiritChain, getSpiritChains } from "../src/engine/gamedata.js";
import { getMonsterStats } from "../src/engine/stats.js";
import { grantExtractRewards, defeatGold, defeatEssence, chestEssence, healTeam, stormDamageTeam } from "../src/engine/progression.js";
import { canThrow, rollChainDrop, clusterTargets } from "../src/engine/spiritchains.js";
import { purchaseUpgrade, getUpgradeDef, vaultCapacity } from "../src/engine/upgrades.js";
import { sprintingNow, tickStamina, sprintMult } from "../src/engine/movement.js";
import { generateMonster } from "./content.js";
import { maybeStartPvp, startPvp, handlePvpAction, endPvpFor } from "./pvp.js";

// Area-of-interest radii (world px) for snapshot filtering.
const AOI_RADIUS = 900; // visible monsters within this of a player
const REVEAL_RADIUS = GAME.REVEAL_RADIUS; // hidden monsters only reveal within this (ambush)
const HIDDEN_MONSTER_PCT = GAME.HIDDEN_MONSTER_PCT; // ~this % of monsters start hidden (Q2); shared w/ SP
const ENCOUNTER_RADIUS = 44; // walk within this of a monster to start a fight
const EXTRACT_RADIUS = 48; // step within this of a portal to extract
const STORM_DPS = GAME.STORM_DPS; // active-monster HP/s outside the safe zone (shared w/ SP)
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
  encounterRadius = ENCOUNTER_RADIUS,
  hiddenMonsterPct = HIDDEN_MONSTER_PCT,
  energyRestorePct = GAME.ENERGY_RESTORE_PCT,
  pvpRadius = 40,
} = {}) {
  return {
    cfg: {
      countdownTicks, minPlayers, roundDurationS, circleStartS, portalIntervalS, monsterGenRate, pvpEnabled,
      baseSpeed, stormDps, encounterRadius, hiddenMonsterPct, energyRestorePct, pvpRadius,
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
      if (!profile) profile = createProfile(sanitizeNick(msg.nickname));
      const existing = world.sessions.get(profile.id);
      if (existing && !existing.disconnected) {
        send(conn.ws, { t: "error", code: "already_connected", message: "Profile already connected." });
        return;
      }
      conn.playerId = profile.id;
      const welcome = { t: "welcome", you: { id: profile.id, nickname: profile.name, token: profile.token, team: profile.activeMonsters, vault: profile.vaultMonsters || [], stats: profile.stats || {}, chains: profile.chains || [], equippedChainId: profile.equippedChainId || null, gold: profile.gold || 0, essence: profile.essence || 0, upgrades: profile.upgrades || {} } };

      if (existing && existing.disconnected) {
        // Q12 reconnect within the grace window: re-attach this socket and resume.
        existing.ws = conn.ws;
        existing.disconnected = false;
        existing.disconnectedAt = null;
        send(conn.ws, welcome);
        const round = existing.roundId ? world.rounds.get(existing.roundId) : null;
        const rp = round?.players.get(profile.id);
        if (round && rp) resumeRound(world, existing, round, rp, send);
        else { existing.state = "idle"; existing.roundId = null; } // round ended during the grace window
        return;
      }

      world.sessions.set(profile.id, { profile, ws: conn.ws, state: "idle", roundId: null });
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
      const id = String(msg.chainId || "");
      if ((s.profile.chains || []).some((c) => c.chainId === id)) {
        s.profile.equippedChainId = id;
        saveProfile(s.profile);
      }
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

    case "buyChain": {
      const s = world.sessions.get(conn.playerId);
      if (!s) return;
      if (s.state !== "idle") { // shop only between runs
        send(conn.ws, { t: "shop", ok: false, locked: true, gold: s.profile.gold || 0, essence: s.profile.essence || 0, chains: s.profile.chains || [], equippedChainId: s.profile.equippedChainId || null });
        return;
      }
      const def = getSpiritChain(String(msg.chainId || ""));
      const ok = buyChain(s.profile, def);
      if (ok) saveProfile(s.profile);
      send(conn.ws, { t: "shop", ok, gold: s.profile.gold || 0, essence: s.profile.essence || 0, chains: s.profile.chains || [], equippedChainId: s.profile.equippedChainId || null });
      break;
    }

    case "craftChain": {
      const s = world.sessions.get(conn.playerId);
      if (!s) return;
      if (s.state !== "idle") { // crafting only between runs
        send(conn.ws, { t: "shop", ok: false, locked: true, gold: s.profile.gold || 0, essence: s.profile.essence || 0, chains: s.profile.chains || [], equippedChainId: s.profile.equippedChainId || null });
        return;
      }
      const r = craftUpgrade(s.profile, String(msg.chainId || ""), getSpiritChains());
      if (r.ok) saveProfile(s.profile);
      send(conn.ws, { t: "shop", ok: r.ok, reason: r.reason, gold: s.profile.gold || 0, essence: s.profile.essence || 0, chains: s.profile.chains || [], equippedChainId: s.profile.equippedChainId || null });
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
      // PvP duel (P3-T5)? Route there. Else the PvE path below.
      const pvp = world.pvps.get(msg.combatId);
      if (pvp) { handlePvpAction(world, pvp, conn.playerId, msg.action || {}, send).catch((e) => console.error("[pvp] action:", e)); break; }
      const session = world.combats.get(msg.combatId);
      // NC-11: also assert the combat belongs to the player's CURRENT round — a stale
      // combatId lingering across rounds must not resolve against the new round's state.
      if (!session || session.playerId !== conn.playerId || session.roundId !== s.roundId || session.resolving) return;
      // Resolution may be async (AI). Guard against double-actions while it runs.
      session.resolving = true;
      resolveCombatAction(session, msg.action || {}, session.rng)
        .then((res) => {
          session.resolving = false;
          if (!world.combats.has(session.combatId)) return; // torn down meanwhile
          send(conn.ws, { t: "combatUpdate", combatId: session.combatId, ...res });
          if (res.outcome) endCombat(world, session, res, send);
        })
        .catch((e) => { session.resolving = false; console.error("[combat] resolve error:", e); });
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

    case "ping":
      send(conn.ws, { t: "pong", t0: msg.t0, t1: Date.now() });
      break;
  }
}

// Rearrange a profile's roster from a desired active-team id list. The monsters
// named in `activeIds` (order preserved, deduped, capped at TEAM_SIZE) become the
// active team; every other owned monster falls to the vault (capped at
// VAULT_SIZE). Unknown ids are ignored. Returns true if a valid roster (≥1 active)
// was applied, false otherwise (no mutation) — the team must never be emptied.
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
  // Cap at the player's ACTUAL capacity (base VAULT_SIZE + Deep Vault upgrade) — was
  // GAME.VAULT_SIZE (base only), which would trim a Deep-Vault owner's monsters 101+.
  profile.vaultMonsters = pool.filter((m) => !seen.has(m.id)).slice(0, vaultCapacity(profile, GAME.VAULT_SIZE));
  return true;
}

export function removePlayer(world, playerId, send = () => {}) {
  if (!playerId) return;
  const s = world.sessions.get(playerId);
  if (!s) return;
  if (s.state === "in_round") {
    // Q12: don't drop them immediately — keep their round slot for a grace window
    // so they can reconnect and resume. Any active fight is dropped (resume roaming).
    const round = world.rounds.get(s.roundId);
    const rp = round?.players.get(playerId);
    if (rp?.inCombat) { world.combats.delete(rp.inCombat); rp.inCombat = null; }
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
  }));

  const ids = [...round.players.keys()];
  // GP-5: spread player spawns so 16 players don't all start on the same cluster.
  const spawnTiles = map ? findSpreadSpawns(map.voidMap, spawnRng, ids.length) : null;

  for (const [idx, id] of ids.entries()) {
    const rp = round.players.get(id);
    const s = world.sessions.get(id);
    if (!rp || !s) continue;
    const tile = spawnTiles ? spawnTiles[idx] : { x: 200, y: 200 };
    rp.x = tile.x * E;
    rp.y = tile.y * E;
    rp.stamina = GAME.SPRINT.STAMINA_MAX;
    rp.spawned = true;
    // PT2-T04: start every run at full HP. You always begin a fresh run prepped —
    // matching heal-on-extract. Clears stale damage carried in by a vault monster
    // caught at low HP or a death-refilled team (was "fresh char spawns with a
    // damaged teammate"). Fresh-entry only — resumeRound (reconnect) must NOT heal.
    healTeam(s.profile.activeMonsters);
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
    const v = speed * sprintMult(sprinting, GAME) * biomeSpeedMultAt(round.map, rp.x, rp.y);
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
  processChests(world, round);

  // Spirit-chain throws: spawn queued projectiles, then advance + resolve hits.
  processThrows(world, round);
  stepProjectiles(world, round, dt, send);

  // Encounter detection (instanced duel — others keep moving). Hidden monsters
  // ambush too, since they stay in round.monsters until engaged.
  const ER2 = world.cfg.encounterRadius * world.cfg.encounterRadius;
  for (const [id, rp] of round.players) {
    if (rp.inCombat || rp.inPvp) continue;
    const entry = (round.monsters || []).find((mo) => {
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
  for (const [id, rp] of all) {
    const s = world.sessions.get(id);
    if (!s) continue;
    // AoI: visible monsters within AOI_RADIUS, hidden ones only within REVEAL_RADIUS.
    const nearbyMonsters = monsters
      .filter((mo) => {
        const dx = mo.x - rp.x, dy = mo.y - rp.y, d2 = dx * dx + dy * dy;
        const r = mo.hidden ? REVEAL_RADIUS : AOI_RADIUS;
        return d2 <= r * r;
      })
      .map((mo) => ({ id: mo.id, typeName: mo.typeName, level: mo.level, x: mo.x, y: mo.y }));
    send(s.ws, {
      t: "snapshot",
      tick: world.tick,
      roundId: round.roundId,
      you: { id, x: Math.round(rp.x), y: Math.round(rp.y), ack: rp.lastSeq, team: teamHp(s.profile), chains: chainsView(s.profile), equippedChainId: s.profile.equippedChainId || null, gold: s.profile.gold || 0, essence: s.profile.essence || 0, upgrades: s.profile.upgrades || {}, stamina: Math.round(rp.stamina ?? GAME.SPRINT.STAMINA_MAX) },
      // Q13: rivals are AoI-filtered like monsters — only those within view range
      // appear (a threat you discover, not always-on blips).
      players: all
        .filter(([oid, orp]) => oid !== id && sqDist(orp.x, orp.y, rp.x, rp.y) <= AOI_RADIUS * AOI_RADIUS)
        .map(([oid, orp]) => ({
          id: oid,
          name: world.sessions.get(oid)?.profile.name,
          x: Math.round(orp.x),
          y: Math.round(orp.y),
          skinId: world.sessions.get(oid)?.profile.equippedSkinId || null, // CN-12: rivals' cosmetic
        })),
      monsters: nearbyMonsters,
      // In-flight spirit chains, AoI-filtered like monsters/players. vx,vy let the
      // client extrapolate between half-rate snapshots for smooth flight.
      projectiles: (round.projectiles || [])
        .filter((pr) => sqDist(pr.x, pr.y, rp.x, rp.y) <= AOI_RADIUS * AOI_RADIUS)
        .map((pr) => ({ id: pr.id, x: Math.round(pr.x), y: Math.round(pr.y), vx: pr.vx, vy: pr.vy, chainId: pr.chainId })),
      // Loot chests in view (AoI-filtered like monsters). Loot stays hidden
      // until opened — clients only learn position + that it's a chest.
      chests: (round.chests || [])
        .filter((c) => sqDist(c.x, c.y, rp.x, rp.y) <= AOI_RADIUS * AOI_RADIUS)
        .map((c) => ({ id: c.id, x: c.x, y: c.y })),
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
    // Zone damage outside the circle (not while in an instanced fight or duel).
    if (elapsed >= cfg.circleStartS && !rp.inCombat && !rp.inPvp) {
      if (sqDist(cx, cy, rp.x, rp.y) > round.circleRadius * round.circleRadius) {
        if (applyStorm(s, world.cfg.stormDps * dt)) endRunForPlayer(world, round, id, "zone", send);
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

// Storm damage to the active monster; advance on faint. Returns true if the
// whole team is now down (run lost to the zone).
function applyStorm(s, dmg) {
  return stormDamageTeam(s.profile.activeMonsters, dmg); // shared w/ SP (engine/progression.js)
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

function endRunForPlayer(world, round, id, reason, send) {
  const s = world.sessions.get(id);
  const rp = round.players.get(id);
  if (rp?.inCombat) world.combats.delete(rp.inCombat);
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
    if (reason === "extracted") {
      grantExtractRewards(s.profile); // survivors heal + extract gold bonus (shared engine helper — P10-T3)
      finalizeRunChains(s.profile, true, getSpiritChain); // run-found chains banked
      bumpStat(s.profile, "extractions"); // P8-T1
      saveProfile(s.profile);
      send(s.ws, { t: "extracted", reason, team: s.profile.activeMonsters, stats: s.profile.stats, gains });
    } else {
      // Q10: death loses the active run team (vault kept per Q9). Refill from the
      // vault, else roll fresh starters so a player is never left with nothing.
      const prof = s.profile;
      bumpStat(prof, "deaths"); // P8-T1
      prof.vaultMonsters = prof.vaultMonsters || [];
      prof.activeMonsters = prof.vaultMonsters.splice(0, GAME.TEAM_SIZE);
      if (prof.activeMonsters.length === 0) prof.activeMonsters = rollStarters();
      finalizeRunChains(prof, false, getSpiritChain); // run-found chains lost on death
      saveProfile(prof);
      send(s.ws, { t: "died", reason, team: prof.activeMonsters, stats: prof.stats, gains });
    }
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
    const max = mt ? getMonsterStats(mt, m.level).health : Math.round(m.currentHealth) || 1;
    return { hp: Math.max(0, Math.round(m.currentHealth)), max };
  });
}

// Compact mirror of a profile's chain inventory for the snapshot, so the client
// HUD reflects throwCount/durability the moment the server mutates them.
function chainsView(profile) {
  return (profile.chains || []).map((c) => ({
    chainId: c.chainId,
    throwCount: c.throwCount,
    durability: c.durability,
  }));
}


function sqDist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

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
  if (!rp || rp.inCombat) return;

  // Q8: partial energy restore per encounter so a depleted team can still fight.
  for (const m of team) if (m.currentHealth > 0) restoreEnergyPartial(m, world.cfg.energyRestorePct);

  // Engaged monsters leave the map. The primary + any multi/area `queue` are
  // removed together HERE (after the early-return guards) so a failed start never
  // strands clustered monsters off the map.
  const queue = opts.queue || [];
  round.monsters = round.monsters.filter((m) => m !== entry && !queue.includes(m));
  const enemy = makeEnemy(entry);
  const combatId = "c" + world.nextCombat++;
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
    if ((prof.activeMonsters?.length || 0) < GAME.TEAM_SIZE) prof.activeMonsters.push(caught);
    else {
      // Vault overflow: cap at the player's capacity (base + Deep Vault) so repeated
      // catches with a full team can't grow the vault/profile without bound — was an
      // uncapped push (the catch-path twin of the NC-5 PvP-loot cap). Full → dropped.
      prof.vaultMonsters = prof.vaultMonsters || [];
      if (prof.vaultMonsters.length < vaultCapacity(prof, GAME.VAULT_SIZE)) prof.vaultMonsters.push(caught);
    }
    bumpStat(prof, "caught"); // P8-T1
    consumeChainCharge(prof, session.chainId); // spend one capture charge
  } else if (res.outcome === "won") {
    s.profile.gold = (s.profile.gold || 0) + defeatGold(s.profile, session.enemy?.level || 1);
    s.profile.essence = (s.profile.essence || 0) + defeatEssence(s.profile);
  } else if (res.outcome === "fled" && round && session.monsterEntry) {
    round.monsters.push(session.monsterEntry); // monster returns to the map
  }
  // won: monster stays removed. lost: team fainted (run penalty handled in P4).

  // Multi/area chain: flee/lose abandons the cluster (queued monsters go back to
  // the map so they're not lost); win/catch continues to the next queued monster.
  const cont = res.outcome === "won" || res.outcome === "caught";
  const queue = session.queue || [];
  if (!cont && round) for (const e of queue) round.monsters.push(e);

  saveProfile(s.profile);
  world.combats.delete(session.combatId);
  send(s.ws, {
    t: "combatEnd",
    combatId: session.combatId,
    outcome: res.outcome,
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
    if (profile.equippedChainId === chainId) profile.equippedChainId = chains[0]?.chainId || null;
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
      if (loot.length) out.push({ id: `ch${i}`, x: tx * E + E / 2, y: ty * E + E / 2, loot });
      break;
    }
  }
  return out;
}

// Open a chest when a roaming player reaches it (server-authoritative grant).
// Granted chains are flagged run-found (provisional until extraction).
function processChests(world, round) {
  if (!round.chests || round.chests.length === 0) return;
  const r2 = GAME.SPIRIT_CHAIN.PICKUP_RADIUS * GAME.SPIRIT_CHAIN.PICKUP_RADIUS;
  for (const [id, rp] of round.players) {
    if (rp.inCombat || rp.inPvp) continue;
    const idx = round.chests.findIndex((c) => sqDist(c.x, c.y, rp.x, rp.y) <= r2);
    if (idx < 0) continue;
    const chest = round.chests[idx];
    const s = world.sessions.get(id);
    if (s) {
      for (const chainId of chest.loot) {
        const def = getSpiritChain(chainId);
        if (def) grantChain(s.profile, chainId, def, true);
      }
      s.profile.essence = (s.profile.essence || 0) + chestEssence(s.profile);
      saveProfile(s.profile);
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
    if (cs.throwCount != null) cs.throwCount--; // a miss still costs a throw
    saveProfile(s.profile);
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

    // expiry: range, ttl, or wall
    if (pr.dist < pr.maxDist && pr.ttl > 0 && isWalkable(round.map, pr.x, pr.y)) keep.push(pr);
  }
  round.projectiles = keep;
}

// Tile collision: voidMap truthy = walkable floor (DLA-carved). World coord /
// EFFECTIVE_TILE = tile index. No map yet (still loading) → permissive.
function isWalkable(map, x, y) {
  if (!map?.voidMap) return true;
  const E = GAME.EFFECTIVE_TILE;
  const tx = Math.floor(x / E), ty = Math.floor(y / E);
  // Walkable = DLA-carved floor AND not a collidable tile (e.g. water). Previously
  // only voidMap was checked, so players could walk ON water online (collidable
  // tiles sit on void-walkable cells). Mirrors the SP client's isWalkable.
  // Require a present tile too (not just voidMap) so collision matches the renderer's
  // floor definition (tileMap != null) — a void cell with no tile reads as wall on the
  // client, so it must not be walkable here either (no "invisible wall"; BUGFIX_LOG).
  const tile = map.tileMap?.[tx]?.[ty];
  return !!map.voidMap[tx]?.[ty] && !!tile && !tile.collidable;
}

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
