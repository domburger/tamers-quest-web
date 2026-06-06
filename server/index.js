// Tamers Quest authoritative game server (P1-T1 scaffold).
// WebSocket transport + fixed-rate tick loop. The shared game logic lives in
// src/engine/ (imported by world.js) so client and server run identical rules.
//
// Run: npm run server   (PORT env optional, default 8080)

import { WebSocketServer } from "ws";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setGameData } from "../src/engine/gamedata.js";
import { createWorld, handleMessage, removePlayer, tickWorld } from "./world.js";

const PORT = Number(process.env.PORT) || 8080;
const TICK_HZ = 15;
const COUNTDOWN_S = Number(process.env.MATCH_COUNTDOWN_S ?? 5);
const MIN_PLAYERS = Number(process.env.MATCH_MIN_PLAYERS ?? 1);
const envNum = (v) => (v === undefined ? undefined : Number(v)); // undefined → engine default

loadGameData();
const world = createWorld({
  countdownTicks: Math.max(1, Math.round(COUNTDOWN_S * TICK_HZ)),
  minPlayers: MIN_PLAYERS,
  roundDurationS: envNum(process.env.ROUND_DURATION_S),
  circleStartS: envNum(process.env.CIRCLE_START_S),
  portalIntervalS: envNum(process.env.PORTAL_INTERVAL_S),
});

const wss = new WebSocketServer({ port: PORT });
console.log(`[tamers-quest] server on :${PORT} | ${TICK_HZ}Hz | match: ${COUNTDOWN_S}s countdown, min ${MIN_PLAYERS}`);

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

// Graceful shutdown (Railway/Docker send SIGTERM).
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    clearInterval(timer);
    wss.close(() => process.exit(0));
  });
}

export { world }; // exported for tests/inspection
