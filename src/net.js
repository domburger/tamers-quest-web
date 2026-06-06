// Client networking — connects the browser client to the authoritative server.
// Framework-agnostic (no Kaboom): scenes call connect/join/queue/move and
// subscribe to events. The session token is persisted so an anonymous player
// resumes their profile across reloads. Testable by injecting a WebSocket impl
// and a storage shim; the message→state reducer (applyMessage) is pure.

export const TOKEN_KEY = "tq_session_token";

const DEFAULT_URL =
  typeof location !== "undefined" && location.protocol === "https:"
    ? `wss://${location.host}`
    : "ws://localhost:8080";

// Pure reducer: fold a server message into the client state. Exported for tests.
// `ctx.storage` persists the session token; `ctx.emit(event, data)` notifies.
export function applyMessage(state, m, ctx = {}) {
  const { storage, emit = () => {} } = ctx;
  switch (m.t) {
    case "welcome":
      state.playerId = m.you.id;
      state.nickname = m.you.nickname;
      state.team = m.you.team || [];
      state.stats = m.you.stats || {};
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
      state.portals = [];
      break;
    case "snapshot":
      if (m.you) {
        const team = m.you.team || state.self?.team; // keep last-known across frames
        state.self = { x: m.you.x, y: m.you.y };
        if (team) state.self.team = team;
        state.ack = m.you.ack;
      }
      state.players = m.players || [];
      state.monsters = m.monsters || [];
      state.time = m.time ?? state.time;
      state.circle = m.circle || null;
      state.portals = m.portals || [];
      break;
    case "combatStart":
      state.combat = { combatId: m.combatId, enemy: m.enemy, active: m.active, attacks: m.attacks || [], log: [], outcome: null, pvp: !!m.pvp, opponent: m.opponent || null, waiting: false };
      break;
    case "combatUpdate":
      if (state.combat) {
        if (m.active) state.combat.active = m.active;
        if (m.enemy) state.combat.enemy = m.enemy;
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
      state.roundResult = { outcome: m.t, reason: m.reason };
      state.phase = "idle";
      state.combat = null;
      if (m.team) state.team = m.team;
      if (m.stats) state.stats = m.stats;
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
    roundId: null,
    seed: null,
    mapSize: 0,
    self: { x: 0, y: 0 },
    players: [],
    monsters: [],
    combat: null,
    time: 0,
    circle: null,
    portals: [],
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
      applyMessage(state, m, { storage, emit });
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
  function unqueue() { send({ t: "unqueue" }); }
  function move(dx, dy) { seq += 1; send({ t: "input", seq, type: "move", payload: { dx, dy } }); return seq; }
  function ping() { send({ t: "ping", t0: Date.now() }); }
  function combatAction(action) { send({ t: "combatAction", combatId: state.combat?.combatId, action }); }
  function clearCombat() { state.combat = null; }
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
    state, on, connect, join, queue, unqueue, move, ping, combatAction, clearCombat, close, clearSession,
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
