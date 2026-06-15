// Tamers Quest authoritative game server (P1-T1 scaffold).
// WebSocket transport + fixed-rate tick loop. The shared game logic lives in
// src/engine/ (imported by world.js) so client and server run identical rules.
//
// Run: npm run server   (PORT env optional, default 8080)

import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import staticHandler from "serve-handler";
import compression from "compression";
import zlib from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setGameData } from "../src/engine/gamedata.js";
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
import { handleAccountHttp } from "./account.js"; // cloud-save character CRUD (/account/*)
import { handlePaddleHttp } from "./paddle.js"; // TQ-68: Paddle payment webhook (/api/paddle/webhook) → grant Essence
import { createBucket, createViolationTracker, createConnLimiter, clientIp } from "./ratelimit.js";
import { loadSettings, loadRoundBiomes } from "./db.js";
import { getMonsterTypes, getGroundTiles, getBiomes } from "../src/engine/gamedata.js";

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
// Per-IP concurrent-connection cap (defense-in-depth): one client IP can't hold more than
// this many sockets at once, so a single source can't grab a large share of CONN_MAX_TOTAL.
// Kept generous — a busy NAT/CGNAT legitimately shares an IP across many users — and keyed on
// the TRUSTED clientIp() hop (TRUSTED_PROXY_HOPS). Set 0 to disable (e.g. if a proxy buckets
// all users under one IP). The global cap above remains the primary safety fallback.
const CONN_MAX_PER_IP = Number(process.env.CONN_MAX_PER_IP ?? 40);

loadGameData();
// Load durable state before accepting connections (no-ops without DATABASE_URL).
await initStore();
await initContent(); // merge previously AI-generated monsters into the pool (P5)
await initPrompts(); // load admin prompt overrides (P7)
await initAiConfig(); // load admin AI model/param overrides (P7 extension)
await initSchemaDesc(); // load admin schema-field-description overrides
await initGenConfig(); // load admin round-composition + generation knobs (TQ-364)
await initGenSchedule(); // load the per-time generation schedule + last-run timestamps (TQ-369)
const savedSettings = await loadSettings(); // admin overrides (P7), {} without a DB
const world = createWorld({
  countdownTicks: Math.max(1, Math.round(COUNTDOWN_S * TICK_HZ)),
  minPlayers: MIN_PLAYERS,
  roundDurationS: envNum(process.env.ROUND_DURATION_S),
  circleStartS: envNum(process.env.CIRCLE_START_S),
  portalIntervalS: envNum(process.env.PORTAL_INTERVAL_S),
  monsterGenRate: Number(process.env.MONSTER_GEN_RATE || 0), // P5: 0 = off (default)
  pvpEnabled: process.env.PVP_ENABLED !== "false", // P3-T5: ON by default; set PVP_ENABLED=false to disable
  salesEnabled: process.env.SALES_ENABLED === "true", // TQ-198: real-money sales kill-switch — DEFAULT OFF (only SALES_ENABLED=true, or the admin toggle, turns it on)
  encounterRadius: envNum(process.env.ENCOUNTER_RADIUS), // ops/QA knob (default 44); env-settable like the others
  ...savedSettings, // admin-panel changes persist and win over env defaults
});
// TQ-365: restore the rotating round-biome ring so the stable set survives restarts. When present,
// mark it initialized so the next round ROTATES (11 reused + 1 new) rather than re-seeding.
const savedBiomes = await loadRoundBiomes(); // {} without a DB
if (Array.isArray(savedBiomes.order) && savedBiomes.order.length) {
  world.biomeOrder = savedBiomes.order;
  world.biomesInitialized = true;
}

// Combined (default): serve dist/ over HTTP + the game over WebSocket on one port.
// WS-only (SERVE_STATIC=false): a tiny health endpoint instead of static — for a
// dedicated game service. Splitting later = these flags + VITE_SERVER_URL on the
// client build (see docs/REQUIREMENTS.md "Separating the game server").
const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
// TQ-265: serve the HTML/CSS visual-builder modules so the static admin page can render a generated
// monster's authored html model (monster.html) as a LIVE-DOM preview — sanitized via the same TQ-261
// sanitizer the game render path uses. htmlSanitize.js imports "./htmlModel.js", so both are served
// under /admin/ and the relative import resolves. Dependency-light leaves; already client-bundled.
let HTML_MODEL_SRC = "", HTML_SANITIZE_SRC = "";
try {
  const _sysDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "systems");
  HTML_MODEL_SRC = readFileSync(join(_sysDir, "htmlModel.js"), "utf8");
  HTML_SANITIZE_SRC = readFileSync(join(_sysDir, "htmlSanitize.js"), "utf8");
} catch (e) { console.warn("[admin] gen-hub preview: could not load htmlModel/htmlSanitize.js:", e.message); }
// TQ-370: serve the tile renderer too, so the admin tile visual-builder's baked-texture PREVIEW works
// in PROD. admin.html imported "/src/render/tiles.js" (Vite-dev-only → 404 in prod → preview silently
// hidden); tiles.js is import-free, so serve its source under /admin/ like the html modules above.
let TILE_RENDER_SRC = "";
try {
  TILE_RENDER_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "render", "tiles.js"), "utf8");
} catch (e) { console.warn("[admin] tile preview: could not load render/tiles.js:", e.message); }
// TQ-374: item icon renderer for the admin item visual-builder preview (import-free leaf, like tiles.js).
let ITEM_ICON_SRC = "";
try {
  ITEM_ICON_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "render", "itemIcon.js"), "utf8");
} catch (e) { console.warn("[admin] item preview: could not load render/itemIcon.js:", e.message); }

// gzip/brotli responses. serve-handler ships assets uncompressed, so the ~1.2 MB Phaser
// chunk + the ~660 KB of game-data JSON went over the wire raw. compression negotiates
// Accept-Encoding and only touches compressible content-types (JS/JSON/HTML/CSS —
// fonts/images skipped). It compresses via zlib STREAMS (libuv threadpool, NOT the main
// loop) so it never blocks the game tick.
//
// Brotli quality 5 (the lib default is 4): benchmarked as the ratio/CPU knee for our
// payloads — vs q4 it trims the Phaser chunk 312->282 kB and each /api/groundtiles
// (~370 kB, re-sent every startup) 44->36 kB for ~+2 ms, while q11 would cost ~1.5 s
// for Phaser (a cliff we stay well below). Safe here because the big assets are
// immutable-cached (compressed rarely) and the dynamic JSON stays small/fast.
const compress = compression({ brotli: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } } });

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

// All HTTP handling runs INSIDE the compression middleware so EVERY response is
// gzip/brotli'd — not just the static bundle but the dynamic /api/* JSON too. The
// client loads its game data at startup PRIMARILY from /api/groundtiles (~370 kB),
// /api/monstertypes (~135 kB), and /api/biomes (static /assets/data is only a
// fallback), so leaving those uncompressed meant the data path actually used still
// shipped raw. compress() only touches compressible content-types and negotiates
// Accept-Encoding, so non-compressible/streamed responses are unaffected.
const httpServer = createServer((req, res) => compress(req, res, () => handleHttp(req, res)));
async function handleHttp(req, res) {
  setSecurityHeaders(res);
  // Admin panel API (P7) — auth-gated; owns /api/admin/*.
  if (await handleAdmin(req, res, world)) return;
  // Single-player combat (FGT-T1 / PARITY-1) — owns /api/combat/*. SP routes its
  // turns through the same AI judge MP uses (no separate SP combat rules).
  if (await handleCombatHttp(req, res)) return;
  // OAuth login (AUTH-T2) — owns /auth/*. Redirects to Google/Discord, handles the
  // callback, and hands the client a session token via /?token=…
  if (await handleAuthHttp(req, res)) return;
  // Cloud-save character CRUD (Phase 2) — owns /account/*, gated by the account session token.
  if (await handleAccountHttp(req, res, world)) return;
  // Paddle payment webhook (TQ-68) — owns POST /api/paddle/webhook. Signature-verified; credits
  // Essence by price ID, idempotent on the transaction id. No-ops (503) until PADDLE_WEBHOOK_SECRET is set.
  if (await handlePaddleHttp(req, res, world)) return; // TQ-198: world.cfg.salesEnabled gates the checkout/webhook
  // The full monster pool (hand-authored + AI-generated) so the client can render
  // every type's procedural sprite. Served by both combined and game-only modes.
  if (req.url === "/api/monstertypes") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify(getMonsterTypes()));
  }
  // The live ground-tile + generated-biome pools (seed + AI-generated), so the client regenerates
  // the SAME deterministic map the server does. Mirrors /api/monstertypes (insertion-ordered →
  // server & every client agree on the WFC/Voronoi inputs). Tiles fall back to the static bundle,
  // biomes to the built-in BIOME_DEFS, if a client can't reach these (offline / static host).
  if (req.url === "/api/groundtiles") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify(getGroundTiles()));
  }
  if (req.url === "/api/biomes") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify(getBiomes()));
  }
  // Public leaderboard (P8-T4): top players by extractions / PvP wins.
  if (req.url === "/api/leaderboard") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify({ extractions: topProfiles("extractions", 10), pvpWins: topProfiles("pvpWins", 10) }));
  }
  // TQ-265: HTML/CSS model + sanitizer modules for the admin live-DOM monster preview.
  if ((req.url || "").split("?")[0] === "/admin/htmlModel.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(HTML_MODEL_SRC);
  }
  if ((req.url || "").split("?")[0] === "/admin/htmlSanitize.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(HTML_SANITIZE_SRC);
  }
  // TQ-370: tile renderer for the admin tile visual-builder's baked-texture preview (prod-safe; was /src/).
  if ((req.url || "").split("?")[0] === "/admin/tiles.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(TILE_RENDER_SRC);
  }
  // TQ-374: item icon renderer for the admin item visual-builder preview (prod-safe).
  if ((req.url || "").split("?")[0] === "/admin/itemIcon.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(ITEM_ICON_SRC);
  }
  // Health check must run BEFORE static serving: in combined/prod mode the static handler would
  // 404 /health (there's no such file), so a monitor would read the live server as DOWN. (This was
  // shadowed — /health returned the static 404 in prod; only the WS-only mode hit the 200 below.)
  if (req.url === "/health") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("ok"); }
  // "/bestiary" is a client SPA route (the admin page deep-links to it). serve-handler
  // would 404 it (no bestiary.html), so rewrite it to index.html — main.js then boots
  // the bestiary scene from the pathname. (Dev: Vite's SPA fallback already does this.)
  if (SERVE_STATIC) return staticHandler(req, res, {
    public: DIST,
    rewrites: [{ source: "/bestiary", destination: "/index.html" }],
    // Cache policy: Vite content-hashes the JS bundles (index-/phaser-/rolldown-runtime-*.js)
    // directly under assets/, so their bytes can NEVER change under a given name — cache them
    // forever (immutable) and returning players skip the network entirely. The HTML entry must
    // stay fresh (no-cache → always revalidate) so a new deploy's index.html — pointing at the
    // NEW hashes — is picked up; without it a stale heuristically-cached HTML could reference a
    // bundle the deploy already replaced. Everything else (un-hashed data JSON, fonts, textures,
    // sw.js) keeps serve-handler's default revalidation, since those names are stable but mutable.
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

const connLimit = createConnLimiter({ maxTotal: CONN_MAX_TOTAL, maxPerIp: CONN_MAX_PER_IP }); // NC-7 + per-IP cap
wss.on("connection", (ws, req) => {
  // NC-7: refuse sockets past the global cap (memory OOM guard) OR the per-IP cap (one source
  // can't monopolize the pool). Each socket holds buffers + can mint a profile. 1013 = "try
  // again later". The IP is the trusted forwarded hop (clientIp), so it's the proxy's client view.
  const ip = clientIp(req);
  if (!connLimit.add(ip)) { try { ws.close(1013, "server at capacity"); } catch {} return; }
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
  ws.on("close", () => { connLimit.remove(ip); removePlayer(world, conn.playerId, send); });
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

// TQ-369: per-time generation scheduler. Once a minute, generate one of each asset whose configured
// cadence has elapsed (all OFF by default — opt-in per asset in /admin). Decoupled + cheap: the tick
// is a no-op when nothing is due, and generate* self-gate on AI being enabled.
const GEN_SCHED_TICK_MS = 60000;
const genSchedTimer = setInterval(() => {
  tickGenSchedule(Date.now(), { biomes: generateBiome, tiles: generateTile, monsters: generateMonster })
    .catch((e) => console.error("[genschedule] tick:", e.message));
}, GEN_SCHED_TICK_MS);
genSchedTimer.unref?.(); // don't keep the process alive just for the scheduler

function send(ws, obj) {
  if (ws.readyState === 1 /* WebSocket.OPEN */) ws.send(JSON.stringify(obj));
}

function loadGameData() {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "assets", "data");
  const read = (f) => JSON.parse(readFileSync(join(dir, f), "utf8"));
  // Pure-AI monster pool: load NO hand-authored seed monsters, so the live pool is ENTIRELY
  // AI-generated (merged from the DB by initContent + grown at runtime) — the "clean wipe →
  // initial AI monsters" reset (2026-06-09). DEFAULT ON in the Railway "production" environment
  // and OFF in local dev / tests, which keep the hand-authored seed as a working fixture +
  // the client's offline fallback. Override explicitly: AI_MONSTERS_ONLY=1 forces it on
  // anywhere; AI_MONSTERS_ONLY=0 forces it OFF on prod (restores the hand-authored monsters).
  // The seed JSON file itself is never modified — only this server's runtime pool is emptied.
  const railwayProd = process.env.RAILWAY_ENVIRONMENT_NAME === "production" || process.env.RAILWAY_ENVIRONMENT === "production";
  const aiOnly = process.env.AI_MONSTERS_ONLY === "1" || (process.env.AI_MONSTERS_ONLY !== "0" && railwayProd);
  setGameData({
    monsterTypes: aiOnly ? [] : read("monstertype.json"),
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
    clearInterval(genSchedTimer); // TQ-369: stop the generation scheduler
    try { await shutdownStore(); } catch {}
    wss.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

export { world }; // exported for tests/inspection
