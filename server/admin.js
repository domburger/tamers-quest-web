// Admin panel API (P7). Auth-gated (ADMIN_TOKEN) endpoints to read/edit the
// live-tunable game config and review generated content. Mounted before the
// static handler in index.js. No-op (503) unless ADMIN_TOKEN is set.

import { createHash, timingSafeEqual } from "node:crypto";
import { saveSettings, loadMonsterTypes } from "./db.js";
import { getMonsterTypes } from "../src/engine/gamedata.js";
import { generateMonster, removeMonster } from "./content.js";
import { allPrompts, setPrompts } from "./prompts.js";
import { allAiConfig, setAiConfig } from "./aiconfig.js";
import { aiEnabled } from "./ai.js"; // so /admin can show whether the OpenAI key is set

// Constant-time token comparison (avoids leaking length/contents via timing).
function tokenMatches(provided, expected) {
  const a = createHash("sha256").update(String(provided)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

// Brute-force throttle: after too many failed auths in a window, lock admin out
// briefly (deters guessing ADMIN_TOKEN). In-memory; resets on a clean restart.
const FAILS = []; // timestamps of recent failed auths
const FAIL_WINDOW_MS = 60000, FAIL_MAX = 10, LOCK_MS = 60000;
let lockedUntil = 0;
function authThrottle(now) {
  while (FAILS.length && now - FAILS[0] > FAIL_WINDOW_MS) FAILS.shift();
  return now < lockedUntil;
}
function recordFail(now) {
  FAILS.push(now);
  if (FAILS.length >= FAIL_MAX) { lockedUntil = now + LOCK_MS; FAILS.length = 0; }
}

// The live-tunable world.cfg fields and their validation. (More — AoI radii, map
// size, etc. — follow once those move into cfg.)
export const TUNABLES = {
  minPlayers: { min: 1, max: 16, int: true },
  roundDurationS: { min: 30, max: 3600, int: true },
  circleStartS: { min: 0, max: 3600, int: true },
  portalIntervalS: { min: 1, max: 600, int: true },
  monsterGenRate: { min: 0, max: 1 },
  pvpEnabled: { bool: true },
  baseSpeed: { min: 50, max: 600, int: true },
  stormDps: { min: 0, max: 500, int: true },
  encounterRadius: { min: 10, max: 200, int: true },
  hiddenMonsterPct: { min: 0, max: 100, int: true },
  energyRestorePct: { min: 0, max: 100, int: true },
  pvpRadius: { min: 10, max: 200, int: true },
};

export function adminConfig(world) {
  const out = {};
  for (const k of Object.keys(TUNABLES)) out[k] = world.cfg[k];
  return out;
}

// Read-only live-ops snapshot (P7-T4).
export function adminStats(world) {
  const rounds = [...world.rounds.values()].map((r) => ({
    roundId: r.roundId, phase: r.phase, players: r.players.size,
    monsters: (r.monsters || []).length, remaining: Math.round(r.remaining ?? 0),
  }));
  return {
    playersOnline: world.sessions.size,
    inQueue: world.queue.length,
    activeRounds: rounds.filter((r) => r.phase === "active").length,
    rounds,
    activeCombats: world.combats.size,
    activeDuels: world.pvps.size,
    monsterPool: getMonsterTypes().length,
    recentResults: (world.recentResults || []).slice().reverse(),
  };
}

// Validate+coerce one value against its spec; null if invalid.
export function coerce(spec, v) {
  if (spec.bool) return v === true || v === "true" ? true : v === false || v === "false" ? false : null;
  let n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (spec.int) n = Math.round(n);
  return Math.min(spec.max, Math.max(spec.min, n));
}

// Apply a config patch to world.cfg (validated). Returns the fields applied.
export function applyConfig(world, patch) {
  const applied = {};
  if (patch && typeof patch === "object") {
    for (const [k, spec] of Object.entries(TUNABLES)) {
      if (k in patch) {
        const v = coerce(spec, patch[k]);
        if (v !== null) { world.cfg[k] = v; applied[k] = v; }
      }
    }
  }
  return applied;
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (d) => { s += d; if (s.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(s || "{}")); } catch { resolve(null); } });
    req.on("error", () => resolve(null));
  });
}

// Handle an /api/admin/* request. Returns true if it owned the route.
export async function handleAdmin(req, res, world) {
  if (!req.url.startsWith("/api/admin/")) return false;
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };
  const token = process.env.ADMIN_TOKEN;
  if (!token) { json(503, { error: "admin disabled — set ADMIN_TOKEN" }); return true; }
  const now = Date.now();
  if (authThrottle(now)) { json(429, { error: "too many attempts — locked, try later" }); return true; }
  if (!tokenMatches(req.headers["x-admin-token"] || "", token)) {
    recordFail(now);
    json(401, { error: "unauthorized" });
    return true;
  }

  const path = req.url.split("?")[0];
  if (path === "/api/admin/prompts" && req.method === "GET") { json(200, allPrompts()); return true; }
  if (path === "/api/admin/prompts" && req.method === "POST") {
    const body = await readBody(req);
    if (body === null) { json(400, { error: "invalid JSON" }); return true; }
    json(200, { ok: true, prompts: await setPrompts(body) });
    return true;
  }
  if (path === "/api/admin/aiconfig" && req.method === "GET") { json(200, { ...allAiConfig(), aiEnabled: aiEnabled() }); return true; }
  if (path === "/api/admin/aiconfig" && req.method === "POST") {
    const body = await readBody(req);
    if (body === null) { json(400, { error: "invalid JSON" }); return true; }
    json(200, { ok: true, aiconfig: await setAiConfig(body) });
    return true;
  }
  if (path === "/api/admin/config" && req.method === "GET") { json(200, adminConfig(world)); return true; }
  if (path === "/api/admin/config" && req.method === "POST") {
    const body = await readBody(req);
    if (body === null) { json(400, { error: "invalid JSON" }); return true; }
    const applied = applyConfig(world, body);
    await saveSettings(adminConfig(world)).catch((e) => console.error("[admin] save:", e.message));
    json(200, { ok: true, applied, config: adminConfig(world) });
    return true;
  }
  if (path === "/api/admin/monsters" && req.method === "GET") {
    const generated = await loadMonsterTypes().catch(() => []);
    json(200, { generated });
    return true;
  }
  if (path === "/api/admin/stats" && req.method === "GET") { json(200, adminStats(world)); return true; }
  if (path === "/api/admin/monsters/generate" && req.method === "POST") {
    const mt = await generateMonster().catch(() => null); // generates → pool → DB
    if (mt) json(200, { ok: true, monster: mt }); // full record so the test view can inspect it
    else json(502, { error: "generation failed (AI off or error)" });
    return true;
  }
  if (path === "/api/admin/monsters/remove" && req.method === "POST") {
    const body = await readBody(req);
    const ok = body?.name ? await removeMonster(body.name).catch(() => false) : false;
    json(200, { ok });
    return true;
  }
  json(404, { error: "not found" });
  return true;
}
