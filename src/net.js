// Client networking — connects the browser client to the authoritative server.
// Framework-agnostic (no Kaboom): scenes call connect/join/queue/move and
// subscribe to events. The session token is persisted so an anonymous player
// resumes their profile across reloads. Testable by injecting a WebSocket impl
// and a storage shim; the message→state reducer (applyMessage) is pure.

export const TOKEN_KEY = "tq_session_token";

// WS endpoint. Prod (https) → same origin (`wss://host`). Local dev → the server
// on :8080 (the standard `npm run server` port, even when the client is served by
// Vite on :5173). A `?ws=<url>` query param overrides both — used by multi-port QA
// harnesses that run a combined client+server on a non-8080 port (without it, the
// http fallback below would point the socket at :8080, a *different* server).
// Opt-in only: no query param ⇒ identical to before, so prod/standard-dev are
// unaffected.
function resolveDefaultWsUrl() {
  if (typeof location === "undefined") return "ws://localhost:8080";
  const override = new URLSearchParams(location.search).get("ws");
  if (override) return override;
  return location.protocol === "https:" ? `wss://${location.host}` : "ws://localhost:8080";
}
const DEFAULT_URL = resolveDefaultWsUrl();

// HTTP base for the game server's REST endpoints (single-player combat judge,
// FGT-T1). Prod (https) → same origin (""). Local dev → the server on :8080 (the
// client is usually served by Vite on :5173, a different origin → cross-origin
// fetch + CORS, which /api/combat/* allows). `?ws=<url>` maps to the matching
// http(s) host so multi-port QA harnesses hit the right server.
export function resolveServerHttpUrl() {
  if (typeof location === "undefined") return "http://localhost:8080";
  const override = new URLSearchParams(location.search).get("ws");
  if (override) return override.replace(/^ws/, "http"); // ws→http, wss→https
  return location.protocol === "https:" ? "" : "http://localhost:8080";
}

// Pure reducer: fold a server message into the client state. Exported for tests.
// `ctx.storage` persists the session token; `ctx.emit(event, data)` notifies.
export function applyMessage(state, m, ctx = {}) {
  const { storage, emit = () => {} } = ctx;
  // Defensive: ignore a non-object / typeless message (mirrors the server's
  // handleMessage guard). The server only sends well-formed messages, but a
  // protocol skew on deploy (a stale tab + a new message shape) or non-object JSON
  // must not throw on `m.t` and break the session.
  if (!m || typeof m.t !== "string") return state;
  switch (m.t) {
    case "welcome":
      state.playerId = m.you.id;
      state.nickname = m.you.nickname;
      state.team = m.you.team || [];
      state.vault = m.you.vault || [];
      state.stats = m.you.stats || {};
      state.chains = m.you.chains || [];
      state.equippedChainId = m.you.equippedChainId || null;
      state.gold = m.you.gold || 0;
      state.essence = m.you.essence || 0;
      state.upgrades = m.you.upgrades || {};
      state.ownedCosmetics = m.you.ownedCosmetics || { chain: [], char: [] }; // CN-9
      state.items = m.you.items || []; // combat items (plan "Decide general items")
      state.migrated = !!m.you.migrated; // SP/MP unify: has this profile been migrated from local?
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
      state.roundId = m.roundId;
      state.seed = m.seed;
      state.mapSize = m.mapSize;
      state.self = { x: m.spawn.x, y: m.spawn.y };
      state.players = m.players || [];
      state.roundResult = null;
      state.killfeed = []; // P8-T5: fresh feed each round
      // Clear the transient AoI view state (monsters/projectiles) — the first
      // snapshot refills them ~1-2 ticks later; until then they'd render the PREVIOUS
      // round's entities at the new spawn.
      state.monsters = [];
      state.projectiles = [];
      // NC-10: a RESUMED roundStart (reconnect / redeploy) carries the live round
      // state, so render it immediately instead of flashing the fresh-round defaults
      // (full zone / no portals / wrong timer) until the first snapshot. A FRESH
      // round clears it (the snapshot fills it shortly after).
      state.circle = m.resumed ? (m.circle || null) : null;
      state.portals = m.resumed ? (m.portals || []) : [];
      state.chests = m.resumed ? (m.chests || []) : [];
      if (m.resumed && m.time != null) state.time = m.time;
      // Clear any stale combat: a mid-fight disconnect tears the combat down
      // server-side (removePlayer → "resume roaming"), so a resumed roundStart
      // must not leave the client stuck on a dead combat overlay. Harmless on a
      // fresh round (combat is only ever set later via combatStart).
      state.combat = null;
      break;
    case "snapshot":
      if (m.you) {
        const team = m.you.team || state.self?.team; // keep last-known across frames
        state.self = { x: m.you.x, y: m.you.y };
        if (team) state.self.team = team;
        state.ack = m.you.ack;
        if (m.you.chains) state.chains = m.you.chains;
        if (m.you.equippedChainId !== undefined) state.equippedChainId = m.you.equippedChainId;
        if (m.you.gold !== undefined) state.gold = m.you.gold;
        if (m.you.essence !== undefined) state.essence = m.you.essence;
        if (m.you.upgrades) state.upgrades = m.you.upgrades;
        if (m.you.stamina !== undefined) state.stamina = m.you.stamina;
      }
      state.players = m.players || [];
      state.monsters = m.monsters || [];
      state.projectiles = m.projectiles || [];
      state.chests = m.chests || [];
      state.time = m.time ?? state.time;
      state.circle = m.circle || null;
      state.portals = m.portals || [];
      break;
    case "combatStart":
      state.combat = { combatId: m.combatId, enemy: m.enemy, active: m.active, attacks: m.attacks || [], team: m.team || [], activeIdx: m.activeIdx ?? 0, log: [], outcome: null, pvp: !!m.pvp, opponent: m.opponent || null, waiting: false };
      break;
    case "combatUnavailable": // FGT-T1: AI judge offline — combat can't start (shown as a toast)
      state.combatNotice = { text: m.reason || "Combat needs a connection.", at: Date.now() };
      break;
    case "combatUpdate":
      if (state.combat) {
        if (m.active) state.combat.active = m.active;
        if (m.enemy) state.combat.enemy = m.enemy;
        // PvP advance fix: a faint promotes the next monster, whose MOVES + team slot
        // differ — adopt the fresh attacks/team/activeIdx the server sends so the action
        // menu doesn't keep offering the fainted monster's moves.
        if (m.attacks) state.combat.attacks = m.attacks;
        if (m.team) state.combat.team = m.team;
        if (m.activeIdx != null) state.combat.activeIdx = m.activeIdx;
        if (m.items) state.items = m.items; // an item use consumed one → reflect the bag
        if (m.narrative) state.combat.log.push(m.narrative);
        state.combat.waiting = !!m.waiting; // PvP: true while awaiting the opponent's move
      }
      break;
    case "combatEnd":
      if (state.combat) state.combat.outcome = m.outcome;
      if (m.team) state.team = m.team;
      break;
    case "extracted":
    case "died":
      state.roundResult = { outcome: m.t, reason: m.reason, gains: m.gains || null };
      state.phase = "idle";
      state.combat = null;
      if (m.team) state.team = m.team;
      if (m.stats) state.stats = m.stats;
      break;
    case "roster": // P8-T2: full collection sync (active team + vault)
      state.team = m.team || [];
      state.vault = m.vault || [];
      // INV-T7: a release reply also syncs the wallet (refund banked) + stashes the
      // outcome so the roster UI can toast "Released  +Ng +M essence" / a refusal.
      if (m.gold !== undefined) state.gold = m.gold;
      if (m.essence !== undefined) state.essence = m.essence;
      if (m.released) state.lastRelease = { ok: !!m.ok, reward: m.reward || null, reason: m.reason || null, locked: !!m.locked, at: Date.now() };
      break;
    case "shop": // spirit shop / craft result — sync gold + essence + chain inventory
      if (m.gold !== undefined) state.gold = m.gold;
      if (m.essence !== undefined) state.essence = m.essence;
      if (m.chains) state.chains = m.chains;
      if (m.equippedChainId !== undefined) state.equippedChainId = m.equippedChainId;
      break;
    case "upgrades": // account upgrade purchase result — sync gold + upgrade levels
      if (m.gold !== undefined) state.gold = m.gold;
      if (m.upgrades) state.upgrades = m.upgrades;
      break;
    case "cosmetic": // CN-9 cosmetic purchase result — sync wallet + owned skin ids
      if (m.gold !== undefined) state.gold = m.gold;
      if (m.essence !== undefined) state.essence = m.essence;
      if (m.ownedCosmetics) state.ownedCosmetics = m.ownedCosmetics;
      state.lastCosmetic = { ok: !!m.ok, reason: m.reason || null, at: Date.now() }; // scene reads the outcome for a toast
      break;
    case "killfeed": // P8-T5: round event feed (PvP defeats, eliminations, extractions)
      state.killfeed = state.killfeed || [];
      state.killfeed.push({ killer: m.killer || null, victim: m.victim || "?", cause: m.cause || "", recvAt: Date.now() });
      if (state.killfeed.length > 6) state.killfeed.shift();
      break;
    case "pong": {
      const sample = Date.now() - m.t0; // round-trip on the client clock only
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
  const storage =
    opts.storage || (typeof localStorage !== "undefined" ? localStorage : memStorage());
  // Auto-reconnect window matches the server's 120s grace (Q12); retry interval.
  const RECONNECT_WINDOW_MS = opts.reconnectWindowMs ?? 120000;
  const RECONNECT_INTERVAL_MS = opts.reconnectIntervalMs ?? 2000;

  const listeners = new Map(); // event -> Set(cb)
  const state = {
    connected: false,
    phase: "idle", // idle | queued | matched | in_round
    playerId: null,
    nickname: null,
    token: storage.getItem(TOKEN_KEY) || null,
    team: [],
    vault: [], // owned monsters not on the active team (P8-T2); synced via welcome/roster
    items: [], // combat items (plan "Decide general items"); synced via welcome
    chains: [], // owned spirit chains (live throwCount/durability counters)
    equippedChainId: null, // which owned chain throws/captures
    gold: 0, // currency for the spirit shop (earned in runs)
    essence: 0, // Spirit Essence (crafting material) earned in runs
    upgrades: {}, // account meta-progression levels (engine/upgrades.js)
    stamina: 100, // sprint stamina (server-authoritative; GAME.SPRINT.STAMINA_MAX)
    roundId: null,
    seed: null,
    mapSize: 0,
    self: { x: 0, y: 0 },
    players: [],
    monsters: [],
    projectiles: [], // in-flight spirit chains broadcast by the server
    chests: [], // loot chests in view (open by walking up)
    combat: null,
    combatNotice: null, // FGT-T1: transient "combat judge offline" toast ({text, at})
    time: 0,
    circle: null,
    portals: [],
    killfeed: [], // P8-T5: recent round events (PvP defeats, eliminations, extractions)
    roundResult: null,
    ack: 0,
    rtt: null, // smoothed round-trip latency (ms), null until the first pong
    reconnecting: false, // true while auto-retrying after an unexpected drop
    stats: {}, // lifetime profile stats (runs/extractions/deaths/caught/pvpWins) — P8-T1
  };
  let ws = null;
  let seq = 0;
  let deliberate = false; // true when close() was called intentionally (no auto-reconnect)
  let hasJoined = false; // only auto-reconnect after an initial join (we have a token to resume)
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
    if (ws && ws.readyState === 1 /* OPEN */) ws.send(JSON.stringify(obj));
  }

  function connect() {
    if (!WS) throw new Error("[net] no WebSocket implementation available");
    deliberate = false;
    ws = new WS(url);
    ws.onopen = () => {
      stopReconnect();
      state.connected = true;
      state.reconnecting = false;
      reconnectDeadline = 0;
      emit("open");
      // On a reconnect we resume our session automatically (server restores the
      // round within its grace window, Q12). The lobby's own open→join handles
      // the first connect (hasJoined still false then).
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
        const raw = typeof evt.data === "string" ? evt.data : evt.data.toString();
        m = JSON.parse(raw);
      } catch { return; }
      // A malformed/unexpected server message (e.g. a missing field after a
      // protocol-skew deploy) must not break the live session — log + drop it and
      // keep processing. applyMessage also self-guards non-object messages.
      try { applyMessage(state, m, { storage, emit }); }
      catch (e) { console.error("[net] dropped bad message", m && m.t, e.message); }
    };
    return ws;
  }

  function stopReconnect() {
    if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null; }
  }
  // Auto-reconnect after an unexpected drop: every interval, if still down and
  // within the grace window, open a fresh socket (onopen auto-resumes the session).
  // Give up after the window → "Connection lost".
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
      if (!ws || ws.readyState === 3 /* CLOSED */) { try { connect(); } catch {} }
    }, RECONNECT_INTERVAL_MS);
  }

  // Actions
  function join(nickname) { hasJoined = true; send({ t: "join", token: state.token || undefined, nickname }); }
  function queue() { send({ t: "queue" }); }
  function queueSolo() { send({ t: "queueSolo" }); } // SP/MP unify: instant private 1-player round
  function unqueue() { send({ t: "unqueue" }); }
  function move(dx, dy, sprint = false) { seq += 1; send({ t: "input", seq, type: "move", payload: { dx, dy, sprint } }); return seq; }
  function throwChain(dir, chainId) { seq += 1; send({ t: "input", seq, type: "throw", payload: { dx: dir.x, dy: dir.y, chainId } }); return seq; }
  function setEquippedChain(chainId) { send({ t: "setEquippedChain", chainId }); }
  function setSkin(skinId) { send({ t: "setSkin", skinId }); } // CN-12: sync cosmetic so others see it
  function buyChain(chainId) { send({ t: "buyChain", chainId }); }
  function craftChain(chainId) { send({ t: "craftChain", chainId }); }
  function buyUpgrade(upgradeId) { send({ t: "buyUpgrade", upgradeId }); }
  function buyCosmetic(kind, skinId) { send({ t: "buyCosmetic", kind, skinId }); } // CN-9 MP cosmetic buy
  function ping() { send({ t: "ping", t0: Date.now() }); }
  function combatAction(action) { send({ t: "combatAction", combatId: state.combat?.combatId, action }); }
  function clearCombat() { state.combat = null; }
  // Roster/vault (P8-T2). getRoster refreshes team+vault; setRoster sets the active
  // team to the given ordered monster ids (server rejects mid-round).
  function getRoster() { send({ t: "getRoster" }); }
  function setRoster(activeIds) { send({ t: "setRoster", activeIds }); }
  function release(monsterId) { send({ t: "release", monsterId }); } // INV-T7: free a monster for a refund (server-gated to idle)
  function heal() { send({ t: "heal" }); } // task 50: free lobby Healer — heal active team to full (server-gated to idle)
  // SP/MP unify: one-time import of the local loadout into a freshly-minted server profile
  // (server validates + gates to a fresh profile). The server replies with a fresh `welcome`.
  function importProfile(loadout) { send({ t: "importProfile", ...(loadout || {}) }); }
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
    state, on, connect, join, queue, queueSolo, unqueue, move, throwChain, setEquippedChain, setSkin, buyChain, craftChain, buyUpgrade, buyCosmetic, ping, combatAction, clearCombat, getRoster, setRoster, release, heal, importProfile, close, clearSession,
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
