import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import staticHandler from "serve-handler";
import compression from "compression";
import zlib from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setGameData, setEvolvedTypes } from "../src/engine/gamedata.js";
import { encodeSnapshot } from "../src/snapshotCodec.js";
import { createWorld, handleMessage, removePlayer, tickWorld } from "./world.js";
import { initStore, shutdownStore, topProfiles } from "./store.js";
import { initContent } from "./content.js";
import { initPrompts } from "./prompts.js";
import { initAiConfig } from "./aiconfig.js";
import { initSchemaDesc } from "./schemaDesc.js";
import { initGenConfig } from "./genConfig.js";
import { initGenSchedule, tickGenSchedule } from "./genSchedule.js";
import { generateBiome, generateTile, generateMonster } from "./content.js";
import { handleAdmin } from "./admin.js";
import { handleCombatHttp } from "./combat.js";
import { handleAuthHttp } from "./auth.js";
import { handleAccountHttp } from "./account.js";
import { handlePaddleHttp } from "./paddle.js";
import { recordClientError } from "./clientErrors.js";
import { createBucket, createViolationTracker, createConnLimiter, clientIp } from "./ratelimit.js";
import { loadSettings, loadRoundBiomes, loadMarketListings, loadEvolvedTypes } from "./db.js";
import { getMonsterTypes, getGroundTiles, getBiomes } from "../src/engine/gamedata.js";
import { setAiOnlyBiomes } from "../src/engine/mapgen.js";

const PORT = Number(process.env.PORT) || 8080;
const TICK_HZ = Math.max(1, Math.min(60, Number(process.env.TICK_HZ) || 30));
const COUNTDOWN_S = Number(process.env.MATCH_COUNTDOWN_S ?? 5);
const MIN_PLAYERS = Number(process.env.MATCH_MIN_PLAYERS ?? 1);
const envNum = (v) => (v === undefined ? undefined : Number(v));
const SERVE_STATIC = process.env.SERVE_STATIC !== "false";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
const RL_CAPACITY = Number(process.env.RL_CAPACITY ?? 50);
const RL_REFILL = Number(process.env.RL_REFILL ?? 30);
const RL_MAX_VIOLATIONS = Number(process.env.RL_MAX_VIOLATIONS ?? 100);
const RL_VIOLATION_DECAY = Number(process.env.RL_VIOLATION_DECAY ?? 3);
const MAX_PAYLOAD = Number(process.env.WS_MAX_PAYLOAD ?? 64 * 1024);
const CONN_MAX_TOTAL = Number(process.env.CONN_MAX_TOTAL ?? 600);
const CONN_MAX_PER_IP = Number(process.env.CONN_MAX_PER_IP ?? 40);

loadGameData();
await initStore();
await initContent();
await initPrompts();
await initAiConfig();
await initSchemaDesc();
await initGenConfig();
await initGenSchedule();
const savedSettings = await loadSettings();
const world = createWorld({
  countdownTicks: Math.max(1, Math.round(COUNTDOWN_S * TICK_HZ)),
  hubBroadcastEvery: Math.max(1, Math.round(TICK_HZ / 5)),
  minPlayers: MIN_PLAYERS,
  roundDurationS: envNum(process.env.ROUND_DURATION_S),
  circleStartS: envNum(process.env.CIRCLE_START_S),
  portalIntervalS: envNum(process.env.PORTAL_INTERVAL_S),
  monsterGenRate: Number(process.env.MONSTER_GEN_RATE || 0),
  pvpEnabled: process.env.PVP_ENABLED !== "false",
  salesEnabled: process.env.SALES_ENABLED === "true",
  encounterRadius: envNum(process.env.ENCOUNTER_RADIUS),
  ...savedSettings, // Keep last: saved admin settings override env defaults.
});
const savedBiomes = await loadRoundBiomes();
if (Array.isArray(savedBiomes.order) && savedBiomes.order.length) {
  world.biomeOrder = savedBiomes.order;
  world.biomesInitialized = true;
}
world.marketListings = await loadMarketListings();
setEvolvedTypes(await loadEvolvedTypes());

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
// Served raw to /admin (no bundler): keep these import-free except ./htmlModel.js.
let HTML_MODEL_SRC = "", HTML_SANITIZE_SRC = "";
try {
  const _sysDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "systems");
  HTML_MODEL_SRC = readFileSync(join(_sysDir, "htmlModel.js"), "utf8");
  HTML_SANITIZE_SRC = readFileSync(join(_sysDir, "htmlSanitize.js"), "utf8");
} catch (e) { console.warn("[admin] gen-hub preview: could not load htmlModel/htmlSanitize.js:", e.message); }
let TILE_RENDER_SRC = "";
try {
  TILE_RENDER_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "render", "tiles.js"), "utf8");
} catch (e) { console.warn("[admin] tile preview: could not load render/tiles.js:", e.message); }
let HTML_MOTION_SRC = "";
try {
  HTML_MOTION_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "render", "htmlMonsterMotion.js"), "utf8");
} catch (e) { console.warn("[admin] monster preview: could not load render/htmlMonsterMotion.js:", e.message); }

const compress = compression({ brotli: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } } });

// unsafe-inline is required by index.html's inline boot script/style.
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

const httpServer = createServer((req, res) => compress(req, res, () => handleHttp(req, res)));
async function handleHttp(req, res) {
  setSecurityHeaders(res);
  if (await handleAdmin(req, res, world)) return;
  if (await handleCombatHttp(req, res)) return;
  if (await handleAuthHttp(req, res)) return;
  if (await handleAccountHttp(req, res, world)) return;
  if (await handlePaddleHttp(req, res, world)) return;
  if (req.url === "/api/monstertypes") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify(getMonsterTypes()));
  }
  // Keep insertion order: clients rebuild the server's exact map from these pools.
  if (req.url === "/api/groundtiles") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify(getGroundTiles()));
  }
  if (req.url === "/api/biomes") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify(getBiomes()));
  }
  if (req.url === "/api/clienterror" && req.method === "POST") {
    let raw = "";
    req.on("data", (d) => { raw += d; if (raw.length > 4096) { raw = raw.slice(0, 4096); req.destroy(); } });
    req.on("end", () => {
      let body = null; try { body = JSON.parse(raw || "{}"); } catch { body = { message: "(unparseable report)" }; }
      const ok = recordClientError(body && typeof body === "object" ? body : {}, clientIp(req));
      res.writeHead(ok ? 204 : 429, { "Cache-Control": "no-store" }); res.end();
    });
    req.on("error", () => { try { res.writeHead(400); res.end(); } catch {} });
    return;
  }
  if (req.url === "/api/leaderboard") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify({ extractions: topProfiles("extractions", 10), pvpWins: topProfiles("pvpWins", 10) }));
  }
  if ((req.url || "").split("?")[0] === "/admin/htmlModel.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(HTML_MODEL_SRC);
  }
  if ((req.url || "").split("?")[0] === "/admin/htmlSanitize.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(HTML_SANITIZE_SRC);
  }
  if ((req.url || "").split("?")[0] === "/admin/tiles.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(TILE_RENDER_SRC);
  }
  if ((req.url || "").split("?")[0] === "/admin/htmlMonsterMotion.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(HTML_MOTION_SRC);
  }
  // Must precede static serving, which would 404 /health.
  if (req.url === "/health") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("ok"); }
  if (SERVE_STATIC) return staticHandler(req, res, {
    public: DIST,
    rewrites: [{ source: "/bestiary", destination: "/index.html" }],
    // HTML must stay no-cache; only content-hashed assets/ may be immutable.
    headers: [
      { source: "assets/*.js", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "**/*.html", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ],
  });
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("tamers-quest game server");
}
const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: MAX_PAYLOAD,
  verifyClient: ALLOWED_ORIGINS.length
    ? ({ origin }) => !origin || ALLOWED_ORIGINS.includes(origin)
    : undefined,
});
httpServer.listen(PORT, () => {
  console.log(`[tamers-quest] ${SERVE_STATIC ? "http+ws" : "ws-only"} on :${PORT} | ${TICK_HZ}Hz | match: ${COUNTDOWN_S}s countdown, min ${MIN_PLAYERS}`);
});

const connLimit = createConnLimiter({ maxTotal: CONN_MAX_TOTAL, maxPerIp: CONN_MAX_PER_IP });
wss.on("connection", (ws, req) => {
  const ip = clientIp(req);
  if (!connLimit.add(ip)) { try { ws.close(1013, "server at capacity"); } catch {} return; }
  const conn = { ws, playerId: null };
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  const bucket = createBucket({ capacity: RL_CAPACITY, refillPerSec: RL_REFILL });
  const violations = createViolationTracker({ max: RL_MAX_VIOLATIONS, decayPerSec: RL_VIOLATION_DECAY });
  ws.on("message", (raw) => {
    if (!bucket.take()) {
      if (violations.record(true)) { try { ws.close(1008, "rate limit"); } catch {} }
      return;
    }
    violations.record(false); // Never reset violations on good traffic: paced floods would dodge the close.
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    simDelay(ws, "_simIn", () => handleMessage(world, conn, msg, send));
  });
  ws.on("close", () => {
    connLimit.remove(ip);
    // Ignore close from a stale socket; the session may already be on a reconnect.
    const s = conn.playerId && world.sessions.get(conn.playerId);
    if (!conn.playerId || (s && s.ws === ws)) removePlayer(world, conn.playerId, send);
  });
  ws.on("error", () => {});
});

let last = Date.now();
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

const HEARTBEAT_MS = 25000;
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, HEARTBEAT_MS);
heartbeat.unref?.();

const GEN_SCHED_TICK_MS = 60000;
const genSchedTimer = setInterval(() => {
  tickGenSchedule(Date.now(), { biomes: generateBiome, tiles: generateTile, monsters: generateMonster })
    .catch((e) => console.error("[genschedule] tick:", e.message));
}, GEN_SCHED_TICK_MS);
genSchedTimer.unref?.();

// send() returns true only if the frame was queued; delta baselines commit on it.
const SIM_ON = !process.env.RAILWAY_ENVIRONMENT && process.env.NODE_ENV !== "production";
const SIM_LAG_MS = SIM_ON ? Math.max(0, Number(process.env.SIM_LAG_MS) || 0) : 0;
const SIM_JITTER_MS = SIM_ON ? Math.max(0, Number(process.env.SIM_JITTER_MS) || 0) : 0;
export function simDelay(holder, key, fn) {
  if (!SIM_LAG_MS && !SIM_JITTER_MS) { fn(); return; }
  const now = Date.now();
  const at = Math.max(holder[key] || 0, now + SIM_LAG_MS / 2 + Math.random() * SIM_JITTER_MS);
  holder[key] = at;
  setTimeout(fn, at - now);
}
if (SIM_LAG_MS || SIM_JITTER_MS) console.log(`[qa] simulated network: ${SIM_LAG_MS}ms RTT + up to ${SIM_JITTER_MS}ms jitter each way`);
const SNAPSHOT_BACKPRESSURE_BYTES = 256 * 1024;
function send(ws, obj) {
  if (ws.readyState !== 1) return false;
  if (obj && obj.t === "snapshot") {
    if (ws.bufferedAmount > SNAPSHOT_BACKPRESSURE_BYTES) return false;
    try { const bytes = encodeSnapshot(obj); simDelay(ws, "_simOut", () => { try { ws.send(bytes); } catch {} }); return true; } catch {}
  }
  try { const json = JSON.stringify(obj); simDelay(ws, "_simOut", () => { try { ws.send(json); } catch {} }); return true; } catch { return false; }
}

function loadGameData() {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "assets", "data");
  const read = (f) => JSON.parse(readFileSync(join(dir, f), "utf8"));
  const railwayProd = process.env.RAILWAY_ENVIRONMENT_NAME === "production" || process.env.RAILWAY_ENVIRONMENT === "production";
  const aiOnly = process.env.AI_MONSTERS_ONLY === "1" || (process.env.AI_MONSTERS_ONLY !== "0" && railwayProd);
  setGameData({
    monsterTypes: aiOnly ? [] : read("monstertype.json"),
    attacks: read("attacks.json"),
    groundTiles: aiOnly ? [] : read("groundtiles.json"),
    items: read("item.json"),
    spiritChains: read("spiritchains.json"),
  });
  setAiOnlyBiomes(aiOnly);
}

process.on("unhandledRejection", (reason) => {
  console.error("[tamers-quest] unhandledRejection:", reason);
});

let shuttingDown = false;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(timer);
    clearInterval(genSchedTimer);
    try { await shutdownStore(); } catch {}
    wss.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

export { world };
