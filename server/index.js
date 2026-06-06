// Tamers Quest authoritative game server (P1-T1 scaffold).
// WebSocket transport + fixed-rate tick loop. The shared game logic lives in
// src/engine/ (imported by world.js) so client and server run identical rules.
//
// Run: npm run server   (PORT env optional, default 8080)

import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import staticHandler from "serve-handler";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setGameData } from "../src/engine/gamedata.js";
import { createWorld, handleMessage, removePlayer, tickWorld } from "./world.js";
import { initStore, shutdownStore } from "./store.js";
import { initContent } from "./content.js";
import { getMonsterTypes } from "../src/engine/gamedata.js";

const PORT = Number(process.env.PORT) || 8080;
const TICK_HZ = 15;
const COUNTDOWN_S = Number(process.env.MATCH_COUNTDOWN_S ?? 5);
const MIN_PLAYERS = Number(process.env.MATCH_MIN_PLAYERS ?? 1);
const envNum = (v) => (v === undefined ? undefined : Number(v)); // undefined → engine default
// Separation-readiness: by default one process serves the client (dist/) AND the
// game on one port (combined). Set SERVE_STATIC=false to run WS-only as a
// dedicated game service; the client then points at it via VITE_SERVER_URL.
const SERVE_STATIC = process.env.SERVE_STATIC !== "false";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);

loadGameData();
// Load durable state before accepting connections (no-ops without DATABASE_URL).
await initStore();
await initContent(); // merge previously AI-generated monsters into the pool (P5)
const world = createWorld({
  countdownTicks: Math.max(1, Math.round(COUNTDOWN_S * TICK_HZ)),
  minPlayers: MIN_PLAYERS,
  roundDurationS: envNum(process.env.ROUND_DURATION_S),
  circleStartS: envNum(process.env.CIRCLE_START_S),
  portalIntervalS: envNum(process.env.PORTAL_INTERVAL_S),
  monsterGenRate: Number(process.env.MONSTER_GEN_RATE || 0), // P5: 0 = off (default)
});

// Combined (default): serve dist/ over HTTP + the game over WebSocket on one port.
// WS-only (SERVE_STATIC=false): a tiny health endpoint instead of static — for a
// dedicated game service. Splitting later = these flags + VITE_SERVER_URL on the
// client build (see docs/REQUIREMENTS.md "Separating the game server").
const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const httpServer = createServer((req, res) => {
  // The full monster pool (hand-authored + AI-generated) so the client can render
  // every type's procedural sprite. Served by both combined and game-only modes.
  if (req.url === "/api/monstertypes") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify(getMonsterTypes()));
  }
  if (SERVE_STATIC) return staticHandler(req, res, { public: DIST });
  res.writeHead(req.url === "/health" ? 200 : 404, { "Content-Type": "text/plain" });
  res.end(req.url === "/health" ? "ok" : "tamers-quest game server");
});
const wss = new WebSocketServer({
  server: httpServer,
  // Cross-origin guard for when the game server runs on its own domain. Allow
  // no-Origin (non-browser) + listed origins; empty list (default) = allow all.
  verifyClient: ALLOWED_ORIGINS.length
    ? ({ origin }) => !origin || ALLOWED_ORIGINS.includes(origin)
    : undefined,
});
httpServer.listen(PORT, () => {
  console.log(`[tamers-quest] ${SERVE_STATIC ? "http+ws" : "ws-only"} on :${PORT} | ${TICK_HZ}Hz | match: ${COUNTDOWN_S}s countdown, min ${MIN_PLAYERS}`);
});

wss.on("connection", (ws) => {
  const conn = { ws, playerId: null };
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    handleMessage(world, conn, msg, send);
  });
  ws.on("close", () => removePlayer(world, conn.playerId));
  ws.on("error", () => {});
});

let last = Date.now();
const timer = setInterval(() => {
  const now = Date.now();
  const dt = (now - last) / 1000;
  last = now;
  try {
    tickWorld(world, dt, send);
  } catch (e) {
    console.error("[tamers-quest] tick error:", e);
  }
}, 1000 / TICK_HZ);

function send(ws, obj) {
  if (ws.readyState === 1 /* WebSocket.OPEN */) ws.send(JSON.stringify(obj));
}

function loadGameData() {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "assets", "data");
  const read = (f) => JSON.parse(readFileSync(join(dir, f), "utf8"));
  setGameData({
    monsterTypes: read("monstertype.json"),
    attacks: read("attacks.json"),
    groundTiles: read("groundtiles.json"),
    items: read("item.json"),
  });
}

// Resilience: a stray promise rejection shouldn't crash the server and drop
// every player's round. Log and keep serving. (Sync uncaughtException is left to
// Node's default — that may mean corrupt state, so let the platform restart.)
process.on("unhandledRejection", (reason) => {
  console.error("[tamers-quest] unhandledRejection:", reason);
});

// Graceful shutdown (Railway/Docker send SIGTERM). Flush profiles before exit so
// a redeploy doesn't lose unsaved changes; force-exit as a backstop.
let shuttingDown = false;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(timer);
    try { await shutdownStore(); } catch {}
    wss.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

export { world }; // exported for tests/inspection
