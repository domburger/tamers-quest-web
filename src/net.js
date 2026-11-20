import { decodeSnapshot } from "./snapshotCodec.js";
import { addEvolvedType } from "./engine/gamedata.js";

export const TOKEN_KEY = "tq_session_token";

function resolveDefaultWsUrl() {
  if (typeof location === "undefined") return "ws://localhost:8080";
  const override = new URLSearchParams(location.search).get("ws");
  if (override) return override;
  return location.protocol === "https:" ? `wss://${location.host}` : "ws://localhost:8080";
}
const DEFAULT_URL = resolveDefaultWsUrl();

function applyDelta(map, upd, gone) {
  if (upd) for (const o of upd) map.set(o.id, o);
  if (gone) for (const id of gone) map.delete(id);
}

export function applyMessage(state, m, ctx = {}) {
  const { storage, emit = () => {} } = ctx;
  if (!m || typeof m.t !== "string") return state;
  switch (m.t) {
    case "welcome":
      // Register evolved types before reading the team (getMonsterType needs them).
      if (Array.isArray(m.you.evolvedTypes)) for (const t of m.you.evolvedTypes) addEvolvedType(t);
      state.playerId = m.you.id;
      state.nickname = m.you.nickname;
      state.team = m.you.team || [];
      state.vault = m.you.vault || [];
      state.stats = m.you.stats || {};
      state.chains = m.you.chains || [];
      state.equippedChainId = m.you.equippedChainId || null;
      state.equippedChainIds = m.you.equippedChainIds || [];
      state.gold = m.you.gold || 0;
      state.essence = m.you.essence || 0;
      state.level = m.you.level || 1;
      state.xp = m.you.xp || 0;
      state.bpSeasonId = m.you.bpSeasonId || null;
      state.bpXp = m.you.bpXp || 0;
      state.bpClaimed = m.you.bpClaimed || [];
      state.adFree = m.you.adFree || false;
      state.subscribed = m.you.subscribed || false;
      state.subscribedUntil = m.you.subscribedUntil || 0;
      state.upgrades = m.you.upgrades || {};
      state.ownedCosmetics = m.you.ownedCosmetics || { chain: [], char: [] };
      state.items = m.you.items || [];
      if (m.you.token) {
        state.token = m.you.token;
        storage && storage.setItem(TOKEN_KEY, m.you.token);
      }
      break;
    case "queued":
      state.phase = "queued";
      break;
    case "matchFound":
      state.phase = "matched";
      state.roundId = m.roundId;
      break;
    case "roundStart":
      state.phase = "in_round";
      state.atRisk = m.atRisk || { catches: 0, items: 0 };
      state.roundId = m.roundId;
      state.seed = m.seed;
      state.roundBiomes = m.biomes || null;
      state.roundComp = m.comp || null;
      state.mapSize = m.mapSize;
      state.adventure = !!m.adventure;
      state.depth = m.depth || 1;
      state.self = { x: m.spawn.x, y: m.spawn.y };
      state.players = m.players || [];
      state.roundResult = null;
      state.killfeed = [];
      state.monsters = [];
      state.projectiles = [];
      if (state._view) { state._view.players.clear(); state._view.monsters.clear(); state._view.projectiles.clear(); state._view.chests.clear(); }
      state.circle = m.resumed ? (m.circle || null) : null;
      state.portals = m.resumed ? (m.portals || []) : [];
      state.chests = m.resumed ? (m.chests || []) : [];
      if (m.resumed && m.time != null) state.time = m.time;
      state.combat = null;
      break;
    case "snapshot":
      if (m.you) {
        // youMeta is sent only on change; keep last-known values when absent.
        const prevTeam = state.self?.team;
        state.self = { x: m.you.x, y: m.you.y };
        state.self.danger = m.you.danger || 0;
        state.ack = m.you.ack;
        if (m.you.stamina !== undefined) state.stamina = m.you.stamina;
        const team = (m.youMeta && m.youMeta.team) || prevTeam;
        if (team) state.self.team = team;
      }
      if (m.youMeta) {
        const ym = m.youMeta;
        if (ym.chains) state.chains = ym.chains;
        if (ym.equippedChainId !== undefined) state.equippedChainId = ym.equippedChainId;
        if (ym.equippedChainIds !== undefined) state.equippedChainIds = ym.equippedChainIds;
        if (ym.gold !== undefined) state.gold = ym.gold;
        if (ym.essence !== undefined) state.essence = ym.essence;
        if (ym.upgrades) state.upgrades = ym.upgrades;
      }
      // Rebuild arrays as new refs: render smoothing detects new snapshots by reference.
      if (!state._view) state._view = { players: new Map(), monsters: new Map(), projectiles: new Map(), chests: new Map() };
      const v = state._view;
      if (m.full) { v.players.clear(); v.monsters.clear(); v.projectiles.clear(); v.chests.clear(); }
      applyDelta(v.players, m.players, m.pGone);
      applyDelta(v.monsters, m.monsters, m.mGone);
      applyDelta(v.projectiles, m.projectiles, m.prGone);
      applyDelta(v.chests, m.chests, m.chGone);
      state.players = [...v.players.values()];
      state.monsters = [...v.monsters.values()];
      state.projectiles = [...v.projectiles.values()];
      state.chests = [...v.chests.values()];
      state.time = m.time ?? state.time;
      state.circle = m.circle || null;
      state.portals = m.portals || [];
      break;
    case "hubSnapshot":
      state.hubPlayers = m.players || [];
      break;
    case "combatStart":
      state.combat = { combatId: m.combatId, enemy: m.enemy, active: m.active, attacks: m.attacks || [], team: m.team || [], activeIdx: m.activeIdx ?? 0, log: [], outcome: null, pvp: !!m.pvp, opponent: m.opponent || null, waiting: false };
      break;
    case "combatUnavailable":
      state.combatNotice = { text: m.reason || "Combat needs a connection.", at: Date.now() };
      break;
    case "lootNotice":
      state.lootNotice = { text: m.text || "Bag full", at: Date.now() };
      break;
    case "combatUpdate":
      if (state.combat) {
        if (m.active) state.combat.active = m.active;
        if (m.enemy) state.combat.enemy = m.enemy;
        if (m.attacks) state.combat.attacks = m.attacks;
        if (m.team) state.combat.team = m.team;
        if (m.activeIdx != null) state.combat.activeIdx = m.activeIdx;
        if (m.items) state.items = m.items;
        if (m.narrative) state.combat.log.push(m.narrative);
        state.combat.waiting = !!m.waiting;
      }
      break;
    case "combatEnd":
      if (state.combat) {
        state.combat.outcome = m.outcome; if (m.caughtPlacement) state.combat.placement = m.caughtPlacement;
        state.combat.gains = m.gains || null; state.combat.caught = m.caught || null;
        state.combat.endedAt = Date.now();
      }
      if (m.team) state.team = m.team;
      break;
    case "atRisk":
      state.atRisk = { catches: m.catches || 0, items: m.items || 0 };
      break;
    case "extracted":
    case "died":
      state.roundResult = { outcome: m.t, reason: m.reason, gains: m.gains || null, lostCatches: m.lostCatches || 0, lostItems: m.lostItems || 0 };
      state.phase = "idle";
      state.combat = null;
      if (m.team) state.team = m.team;
      if (m.stats) state.stats = m.stats;
      if (m.profile) {
        const y = m.profile;
        state.vault = y.vault || []; state.chains = y.chains || []; state.equippedChainId = y.equippedChainId || null; state.equippedChainIds = y.equippedChainIds || [];
        state.gold = y.gold || 0; state.essence = y.essence || 0; state.level = y.level || 1; state.xp = y.xp || 0; state.items = y.items || [];
        state.bpXp = y.bpXp || 0; state.bpClaimed = y.bpClaimed || [];
      }
      break;
    case "evolved":
      if (Array.isArray(m.types)) for (const t of m.types) addEvolvedType(t);
      if (m.team) state.team = m.team;
      state.evolved = { events: m.events || [], at: Date.now() };
      break;
    case "roster":
      state.team = m.team || [];
      state.vault = m.vault || [];
      if (m.gold !== undefined) state.gold = m.gold;
      if (m.essence !== undefined) state.essence = m.essence;
      if (m.released) state.lastRelease = { ok: !!m.ok, reward: m.reward || null, reason: m.reason || null, locked: !!m.locked, at: Date.now() };
      break;
    case "shop":
      if (m.gold !== undefined) state.gold = m.gold;
      if (m.essence !== undefined) state.essence = m.essence;
      if (m.chains) state.chains = m.chains;
      if (m.equippedChainId !== undefined) state.equippedChainId = m.equippedChainId;
      if (m.equippedChainIds !== undefined) state.equippedChainIds = m.equippedChainIds;
      break;
    case "upgrades":
      if (m.gold !== undefined) state.gold = m.gold;
      if (m.upgrades) state.upgrades = m.upgrades;
      break;
    case "market":
      if (Array.isArray(m.evolvedTypes)) for (const t of m.evolvedTypes) addEvolvedType(t);
      if (m.browse) state.market = { listings: m.listings || [], at: Date.now() };
      else state.marketResult = { ok: !!m.ok, reason: m.reason || null, at: Date.now() };
      if (m.sales) state.marketSales = { items: m.sales, at: Date.now() };
      if (m.vault) state.vault = m.vault;
      if (m.gold !== undefined) state.gold = m.gold;
      if (m.essence !== undefined) state.essence = m.essence;
      break;
    case "cosmetic":
      if (m.gold !== undefined) state.gold = m.gold;
      if (m.essence !== undefined) state.essence = m.essence;
      if (m.ownedCosmetics) state.ownedCosmetics = m.ownedCosmetics;
      state.lastCosmetic = { ok: !!m.ok, reason: m.reason || null, at: Date.now() };
      break;
    case "bp":
      if (m.bpSeasonId !== undefined) state.bpSeasonId = m.bpSeasonId;
      if (m.bpXp !== undefined) state.bpXp = m.bpXp;
      if (m.bpClaimed) state.bpClaimed = m.bpClaimed;
      if (m.gold !== undefined) state.gold = m.gold;
      if (m.essence !== undefined) state.essence = m.essence;
      if (m.ownedCosmetics) state.ownedCosmetics = m.ownedCosmetics;
      if (m.chains) state.chains = m.chains;
      state.lastBp = { ok: !!m.ok, reason: m.reason || null, tier: m.tier, track: m.track, at: Date.now() };
      break;
    case "killfeed":
      state.killfeed = state.killfeed || [];
      state.killfeed.push({ killer: m.killer || null, victim: m.victim || "?", cause: m.cause || "", recvAt: Date.now() });
      if (state.killfeed.length > 6) state.killfeed.shift();
      break;
    case "pong": {
      const sample = Date.now() - m.t0;
      state.rtt = state.rtt == null ? sample : Math.round(state.rtt * 0.7 + sample * 0.3);
      break;
    }
  }
  emit(m.t, m.you || m);
  return state;
}

export function createNetClient(opts = {}) {
  const url = opts.url || DEFAULT_URL;
  const WS = opts.WebSocketImpl || (typeof WebSocket !== "undefined" ? WebSocket : null);
  const storage = opts.storage || browserStorage();
  // Must match the server's 120s reconnect grace.
  const RECONNECT_WINDOW_MS = opts.reconnectWindowMs ?? 120000;
  const RECONNECT_INTERVAL_MS = opts.reconnectIntervalMs ?? 2000;

  const listeners = new Map();
  const state = {
    connected: false,
    phase: "idle",
    playerId: null,
    nickname: null,
    token: storage.getItem(TOKEN_KEY) || null,
    team: [],
    vault: [],
    items: [],
    chains: [],
    equippedChainId: null,
    equippedChainIds: [],
    gold: 0,
    essence: 0,
    level: 1,
    xp: 0,
    bpSeasonId: null, bpXp: 0, bpClaimed: [],
    adFree: false,
    subscribed: false,
    subscribedUntil: 0, // epoch ms; 0 = none; active while now < this
    upgrades: {},
    stamina: 100,
    roundId: null,
    seed: null,
    mapSize: 0,
    self: { x: 0, y: 0 },
    players: [],
    hubPlayers: [],
    monsters: [],
    projectiles: [],
    chests: [],
    combat: null,
    combatNotice: null,
    lootNotice: null,
    time: 0,
    circle: null,
    portals: [],
    killfeed: [],
    roundResult: null,
    ack: 0,
    rtt: null,
    reconnecting: false,
    stats: {},
  };
  let ws = null;
  let seq = 0;
  let deliberate = false;
  let hasJoined = false;
  let reconnectTimer = null;
  let reconnectDeadline = 0;

  function on(ev, cb) {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev).add(cb);
    return () => listeners.get(ev)?.delete(cb);
  }
  function emit(ev, data) {
    listeners.get(ev)?.forEach((cb) => {
      try { cb(data); } catch (e) { console.error("[net] listener error", e); }
    });
  }
  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function connect() {
    if (!WS) throw new Error("[net] no WebSocket implementation available");
    deliberate = false;
    ws = new WS(url);
    try { ws.binaryType = "arraybuffer"; } catch {}
    ws.onopen = () => {
      stopReconnect();
      state.connected = true;
      state.reconnecting = false;
      reconnectDeadline = 0;
      emit("open");
      if (hasJoined && state.token) send({ t: "join", token: state.token });
    };
    ws.onclose = () => {
      state.connected = false;
      emit("close");
      if (!deliberate && hasJoined && state.token) scheduleReconnect();
    };
    ws.onerror = (e) => emit("error", e);
    ws.onmessage = (evt) => {
      let m;
      try {
        const d = evt.data;
        if (typeof d === "string") m = JSON.parse(d);
        else if (d instanceof ArrayBuffer) m = decodeSnapshot(new Uint8Array(d));
        else if (d && typeof d.byteLength === "number") m = decodeSnapshot(new Uint8Array(d.buffer || d));
        else m = JSON.parse(String(d));
      } catch { return; }
      try { applyMessage(state, m, { storage, emit }); }
      catch (e) { console.error("[net] dropped bad message", m && m.t, e.message); }
    };
    return ws;
  }

  function stopReconnect() {
    if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null; }
  }
  function scheduleReconnect() {
    if (reconnectTimer || state.connected) return;
    if (!reconnectDeadline) reconnectDeadline = Date.now() + RECONNECT_WINDOW_MS;
    state.reconnecting = true;
    reconnectTimer = setInterval(() => {
      if (state.connected || deliberate) { stopReconnect(); return; }
      if (Date.now() >= reconnectDeadline) {
        stopReconnect();
        state.reconnecting = false;
        reconnectDeadline = 0;
        emit("reconnect_failed");
        return;
      }
      if (!ws || ws.readyState === 3) { try { connect(); } catch {} }
    }, RECONNECT_INTERVAL_MS);
  }

  function join(nickname) { hasJoined = true; send({ t: "join", token: state.token || undefined, nickname }); }
  function queue() { send({ t: "queue" }); }
  function queueSolo(mode) { send(mode ? { t: "queueSolo", mode } : { t: "queueSolo" }); }
  function returnHome() { send({ t: "returnHome" }); }
  function leaveRun() { send({ t: "leaveRun" }); }
  function unqueue() { send({ t: "unqueue" }); }
  function move(dx, dy, sprint = false) { seq += 1; send({ t: "input", seq, type: "move", payload: { dx, dy, sprint } }); return seq; }
  function hubMove(x, y) { send({ t: "hubMove", x, y }); }
  function throwChain(dir, chainId, charge = 0) { seq += 1; send({ t: "input", seq, type: "throw", payload: { dx: dir.x, dy: dir.y, chainId, charge } }); return seq; }
  function setEquippedChain(chainId) { send({ t: "setEquippedChain", chainId }); }
  function setChainSlots(chainIds) { send({ t: "setChainSlots", chainIds }); }
  function setSkin(skinId) { send({ t: "setSkin", skinId }); }
  function setCharSkin(charId) { send({ t: "setCharSkin", charId }); }
  function buyChain(chainId) { send({ t: "buyChain", chainId }); }
  function craftChain(chainId) { send({ t: "craftChain", chainId }); }
  function buyUpgrade(upgradeId) { send({ t: "buyUpgrade", upgradeId }); }
  function claimBpTier(tier, track) { send({ t: "claimBpTier", tier, track }); }
  function buyCosmetic(kind, skinId) { send({ t: "buyCosmetic", kind, skinId }); }
  function marketBrowse() { send({ t: "marketBrowse" }); }
  function marketList(monsterId, gold, essence) { send({ t: "marketList", monsterId, gold, essence }); }
  function marketCancel(listingId) { send({ t: "marketCancel", listingId }); }
  function marketBuy(listingId) { send({ t: "marketBuy", listingId }); }
  // 120 = INTERP_DELAY (0.12s) in ms; keep in sync.
  function ping() { send({ t: "ping", t0: Date.now(), lag: Math.round((state.rtt || 0) / 2 + 120) }); }
  function combatAction(action) { send({ t: "combatAction", combatId: state.combat?.combatId, action }); }
  function clearCombat() { state.combat = null; }
  function getRoster() { send({ t: "getRoster" }); }
  function setRoster(activeIds) { send({ t: "setRoster", activeIds }); }
  function release(monsterId) { send({ t: "release", monsterId }); }
  function heal() { send({ t: "heal" }); }
  function close() {
    deliberate = true;
    stopReconnect();
    state.reconnecting = false;
    reconnectDeadline = 0;
    if (ws) ws.close();
  }
  function clearSession() {
    state.token = null;
    if (storage.removeItem) storage.removeItem(TOKEN_KEY);
    else storage.setItem(TOKEN_KEY, "");
  }

  return {
    state, on, connect, join, queue, queueSolo, returnHome, leaveRun, unqueue, move, hubMove, throwChain, setEquippedChain, setChainSlots, setSkin, setCharSkin, buyChain, craftChain, buyUpgrade, buyCosmetic, claimBpTier, ping, combatAction, clearCombat, getRoster, setRoster, release, heal, marketBrowse, marketList, marketCancel, marketBuy, close, clearSession,
    get seq() { return seq; },
  };
}

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
  };
}

// Touching localStorage can throw (blocked storage); runs at module load, keep guarded.
function browserStorage() {
  try {
    if (typeof localStorage === "undefined") return memStorage();
    localStorage.getItem("__tq_probe__");
    return localStorage;
  } catch {
    return memStorage();
  }
}
