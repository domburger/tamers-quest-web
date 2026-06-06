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
      break;
    case "snapshot":
      if (m.you) {
        state.self = { x: m.you.x, y: m.you.y };
        state.ack = m.you.ack;
      }
      state.players = m.players || [];
      state.monsters = m.monsters || [];
      break;
  }
  emit(m.t, m.you || m);
  return state;
}

export function createNetClient(opts = {}) {
  const url = opts.url || DEFAULT_URL;
  const WS = opts.WebSocketImpl || (typeof WebSocket !== "undefined" ? WebSocket : null);
  const storage =
    opts.storage || (typeof localStorage !== "undefined" ? localStorage : memStorage());

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
    ack: 0,
  };
  let ws = null;
  let seq = 0;

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
    ws = new WS(url);
    ws.onopen = () => { state.connected = true; emit("open"); };
    ws.onclose = () => { state.connected = false; emit("close"); };
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

  // Actions
  function join(nickname) { send({ t: "join", token: state.token || undefined, nickname }); }
  function queue() { send({ t: "queue" }); }
  function unqueue() { send({ t: "unqueue" }); }
  function move(dx, dy) { seq += 1; send({ t: "input", seq, type: "move", payload: { dx, dy } }); return seq; }
  function ping() { send({ t: "ping", t0: Date.now() }); }
  function close() { if (ws) ws.close(); }
  function clearSession() {
    state.token = null;
    if (storage.removeItem) storage.removeItem(TOKEN_KEY);
    else storage.setItem(TOKEN_KEY, "");
  }

  return {
    state, on, connect, join, queue, unqueue, move, ping, close, clearSession,
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
