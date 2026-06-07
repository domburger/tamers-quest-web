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
import { initStore, shutdownStore, topProfiles } from "./store.js";
import { initContent } from "./content.js";
import { initPrompts } from "./prompts.js";
import { initAiConfig } from "./aiconfig.js";
import { handleAdmin } from "./admin.js";
import { handleCombatHttp } from "./combat.js";
import { handleAuthHttp } from "./auth.js";
import { createBucket, createViolationTracker, createConnLimiter } from "./ratelimit.js";
import { loadSettings } from "./db.js";
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
// Per-connection hardening (P8-T7). Token bucket on inbound messages + a payload
// cap. Defaults sit far above legit play (~20 msgs/sec) so only floods are hit.
const RL_CAPACITY = Number(process.env.RL_CAPACITY ?? 50);
const RL_REFILL = Number(process.env.RL_REFILL ?? 30); // tokens/sec
const RL_MAX_VIOLATIONS = Number(process.env.RL_MAX_VIOLATIONS ?? 100); // dropped msgs before we close the socket
const RL_VIOLATION_DECAY = Number(process.env.RL_VIOLATION_DECAY ?? 3); // violations forgiven/sec (NC-8: time-based, not per good msg)
const MAX_PAYLOAD = Number(process.env.WS_MAX_PAYLOAD ?? 64 * 1024); // bytes; game messages are tiny
const CONN_MAX_TOTAL = Number(process.env.CONN_MAX_TOTAL ?? 600); // NC-7: hard cap on concurrent WS connections (OOM guard)

loadGameData();
// Load durable state before accepting connections (no-ops without DATABASE_URL).
await initStore();
await initContent(); // merge previously AI-generated monsters into the pool (P5)
await initPrompts(); // load admin prompt overrides (P7)
await initAiConfig(); // load admin AI model/param overrides (P7 extension)
const savedSettings = await loadSettings(); // admin overrides (P7), {} without a DB
const world = createWorld({
  countdownTicks: Math.max(1, Math.round(COUNTDOWN_S * TICK_HZ)),
  minPlayers: MIN_PLAYERS,
  roundDurationS: envNum(process.env.ROUND_DURATION_S),
  circleStartS: envNum(process.env.CIRCLE_START_S),
  portalIntervalS: envNum(process.env.PORTAL_INTERVAL_S),
  monsterGenRate: Number(process.env.MONSTER_GEN_RATE || 0), // P5: 0 = off (default)
  pvpEnabled: process.env.PVP_ENABLED !== "false", // P3-T5: ON by default; set PVP_ENABLED=false to disable
  encounterRadius: envNum(process.env.ENCOUNTER_RADIUS), // ops/QA knob (default 44); env-settable like the others
  ...savedSettings, // admin-panel changes persist and win over env defaults
});

// Combined (default): serve dist/ over HTTP + the game over WebSocket on one port.
// WS-only (SERVE_STATIC=false): a tiny health endpoint instead of static — for a
// dedicated game service. Splitting later = these flags + VITE_SERVER_URL on the
// client build (see docs/REQUIREMENTS.md "Separating the game server").
const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

// Security headers on every HTTP response. HSTS forces the browser to use HTTPS
// (prevents an SSL-strip / downgrade on the pre-redirect request); the rest are
// cheap clickjacking / MIME-sniff / referrer-leak hardening. TLS itself is
// terminated at Railway's edge (the app speaks plain HTTP behind it, then Railway
// re-wraps the response in HTTPS — so these reach the browser over TLS).
// LS-10: Content-Security-Policy. Ships REPORT-ONLY by default — browsers log
// violations (console / report endpoint) but NEVER block, so it cannot break the
// live site; set CSP_ENFORCE=true to switch the *same* policy to enforcing once
// report-only shows it clean in prod. script/style allow 'unsafe-inline' because
// index.html carries an inline boot <script> + a large inline <style> (owned by
// @phaser); tightening those to nonces/hashes is a follow-up. The policy still
// blocks external-script / frame / object injection and base-uri/form hijacking.
const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' ws: wss:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
].join("; ");
const CSP_HEADER = process.env.CSP_ENFORCE === "true" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

function setSecurityHeaders(res) {
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(CSP_HEADER, CSP_POLICY);
}

const httpServer = createServer(async (req, res) => {
  setSecurityHeaders(res);
  // Admin panel API (P7) — auth-gated; owns /api/admin/*.
  if (await handleAdmin(req, res, world)) return;
  // Single-player combat (FGT-T1 / PARITY-1) — owns /api/combat/*. SP routes its
  // turns through the same AI judge MP uses (no separate SP combat rules).
  if (await handleCombatHttp(req, res)) return;
  // OAuth login (AUTH-T2) — owns /auth/*. Redirects to Google/Discord, handles the
  // callback, and hands the client a session token via /?token=…
  if (await handleAuthHttp(req, res)) return;
  // The full monster pool (hand-authored + AI-generated) so the client can render
  // every type's procedural sprite. Served by both combined and game-only modes.
  if (req.url === "/api/monstertypes") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify(getMonsterTypes()));
  }
  // Public leaderboard (P8-T4): top players by extractions / PvP wins.
  if (req.url === "/api/leaderboard") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify({ extractions: topProfiles("extractions", 10), pvpWins: topProfiles("pvpWins", 10) }));
  }
  if (SERVE_STATIC) return staticHandler(req, res, { public: DIST });
  res.writeHead(req.url === "/health" ? 200 : 404, { "Content-Type": "text/plain" });
  res.end(req.url === "/health" ? "ok" : "tamers-quest game server");
});
const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: MAX_PAYLOAD, // ws auto-closes connections that exceed this (DoS guard)
  // Cross-origin guard for when the game server runs on its own domain. Allow
  // no-Origin (non-browser) + listed origins; empty list (default) = allow all.
  verifyClient: ALLOWED_ORIGINS.length
    ? ({ origin }) => !origin || ALLOWED_ORIGINS.includes(origin)
    : undefined,
});
httpServer.listen(PORT, () => {
  console.log(`[tamers-quest] ${SERVE_STATIC ? "http+ws" : "ws-only"} on :${PORT} | ${TICK_HZ}Hz | match: ${COUNTDOWN_S}s countdown, min ${MIN_PLAYERS}`);
});

const connLimit = createConnLimiter({ maxTotal: CONN_MAX_TOTAL }); // NC-7: shared across all sockets
wss.on("connection", (ws) => {
  // NC-7: refuse sockets past the global cap so a flood of opens can't exhaust memory
  // (each holds buffers + can mint a profile). 1013 = "try again later".
  if (!connLimit.add()) { try { ws.close(1013, "server at capacity"); } catch {} return; }
  const conn = { ws, playerId: null };
  const bucket = createBucket({ capacity: RL_CAPACITY, refillPerSec: RL_REFILL });
  const violations = createViolationTracker({ max: RL_MAX_VIOLATIONS, decayPerSec: RL_VIOLATION_DECAY });
  ws.on("message", (raw) => {
    // Per-connection rate limit (P8-T7): drop over-budget messages, and close a
    // socket that keeps flooding. NC-8: violations decay by TIME, not per good
    // message (a paced flood used to interleave good msgs to dodge the close).
    if (!bucket.take()) {
      if (violations.record(true)) { try { ws.close(1008, "rate limit"); } catch {} }
      return;
    }
    violations.record(false); // advances the time-decay; never resets on good traffic
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    handleMessage(world, conn, msg, send);
  });
  ws.on("close", () => { connLimit.remove(); removePlayer(world, conn.playerId, send); });
  ws.on("error", () => {});
});

let last = Date.now();
// NC-1: clamp dt. A normal tick is ~1/TICK_HZ s (~0.067s @15Hz). If the event loop
// stalls (GC, CPU spike, debugger), `now - last` can balloon to seconds — passed raw,
// tickWorld would advance physics by that whole gap in one step: players teleport
// through walls and the storm one-shots a team. Cap at ~2.25 normal ticks so a stall
// just slows the sim briefly instead of corrupting state.
const MAX_DT = 0.15;
const timer = setInterval(() => {
  const now = Date.now();
  const dt = Math.min(MAX_DT, (now - last) / 1000);
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
    spiritChains: read("spiritchains.json"),
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
