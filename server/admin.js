import { createHash, timingSafeEqual } from "node:crypto";
import { saveSettings, loadMonsterTypes, wipeMonsterTypes, wipeItems, wipeGroundTiles, wipeBiomes } from "./db.js";
import { getMonsterTypes, getItems, getGroundTiles, getBiomes, clearMonsterTypes, clearItems, clearGeneratedTiles, clearBiomes } from "../src/engine/gamedata.js";
import { generateMonster, removeMonster, generateItem, removeGenItem, generateTile, removeGenTile, generateBiome, removeGenBiome,
  saveGeneratedMonster, saveGeneratedItem, saveGeneratedBiome, saveGeneratedTile, genInFlightState, setMonsterGenConcurrency } from "./content.js";
import { makeGenQueue } from "./genQueue.js";

const GEN_FNS = { monster: generateMonster, item: generateItem, biome: generateBiome, tile: generateTile };
const genQueue = makeGenQueue({
  runGen: (type, opts) => { const fn = GEN_FNS[type]; return fn ? fn({ ...(opts || {}), dryRun: false }) : Promise.resolve(null); },
  onConcurrency: (c) => setMonsterGenConcurrency(c),
});
import { wipeAllProfiles } from "./store.js";
import { allPrompts, setPrompts } from "./prompts.js";
import { allAiConfig, setAiConfig } from "./aiconfig.js";
import { allSchemaDesc, setSchemaDesc } from "./schemaDesc.js";
import { allGenConfig, setGenConfig } from "./genConfig.js";
import { allGenSchedule, setGenSchedule } from "./genSchedule.js";
import { aiEnabled } from "./ai.js";
import { listAllModels, providerStatus } from "./llm.js";
import { aiMetricsSnapshot } from "./aiMetrics.js";
import { aiCostSnapshot } from "./aiCost.js";
import { clientErrorsSnapshot } from "./clientErrors.js";
import { hasHtmlModel } from "../src/systems/htmlModel.js";
import { genTraceSnapshot, judgeTraceSnapshot } from "./genTrace.js";

// Constant-time compare: don't simplify to ===.
function tokenMatches(provided, expected) {
  const a = createHash("sha256").update(String(provided)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

const FAILS = [];
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

export const TUNABLES = {
  minPlayers: { min: 1, max: 16, int: true },
  roundDurationS: { min: 30, max: 3600, int: true },
  circleStartS: { min: 0, max: 3600, int: true },
  portalIntervalS: { min: 1, max: 600, int: true },
  monsterGenRate: { min: 0, max: 1 },
  pvpEnabled: { bool: true },
  salesEnabled: { bool: true },
  baseSpeed: { min: 50, max: 600, int: true },
  stormDps: { min: 0, max: 500, int: true },
  dangerFillS: { min: 5, max: 300, int: true },
  dangerDrainS: { min: 1, max: 120, int: true },
  encounterRadius: { min: 10, max: 200, int: true },
  hiddenMonsterPct: { min: 0, max: 100, int: true },
  energyRestorePct: { min: 0, max: 100, int: true },
  pvpRadius: { min: 10, max: 200, int: true },
  monsterApproachPct: { min: 0, max: 100, int: true },
  monsterApproachSpeedFrac: { min: 0, max: 1 },
  monsterApproachRadius: { min: 0, max: 4000, int: true },
};

export function adminConfig(world) {
  const out = {};
  for (const k of Object.keys(TUNABLES)) out[k] = world.cfg[k];
  return out;
}

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
    clientErrors: clientErrorsSnapshot(),
    fightAgent: aiMetricsSnapshot(),
    generation: genInFlightState(),
    generationStats: generationStats(),
    apiCost: aiCostSnapshot(),
  };
}

function generationStats() {
  const monsters = getMonsterTypes() || [], items = getItems() || [], tiles = getGroundTiles() || [], biomes = getBiomes() || [];
  const htmlTile = (t) => !!(t && t.html && typeof t.html.base === "string" && t.html.base.trim());
  const aiMonster = (m) => hasHtmlModel(m) || (Array.isArray(m && m.genAttacks) && m.genAttacks.length > 0);
  return {
    monsters: { total: monsters.length, aiGenerated: monsters.filter(aiMonster).length },
    tiles: { total: tiles.length, aiGenerated: tiles.filter(htmlTile).length },
    items: { total: items.length },
    biomes: { total: biomes.length },
  };
}

export function coerce(spec, v) {
  if (spec.bool) return v === true || v === "true" ? true : v === false || v === "false" ? false : null;
  let n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (spec.int) n = Math.round(n);
  return Math.min(spec.max, Math.max(spec.min, n));
}

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
  if (path === "/api/admin/models" && req.method === "GET") { json(200, { models: await listAllModels({ refresh: /[?&]refresh=1\b/.test(req.url) }), providers: providerStatus() }); return true; }
  if (path === "/api/admin/aiconfig" && req.method === "POST") {
    const body = await readBody(req);
    if (body === null) { json(400, { error: "invalid JSON" }); return true; }
    json(200, { ok: true, aiconfig: await setAiConfig(body) });
    return true;
  }
  if (path === "/api/admin/schemadesc" && req.method === "GET") { json(200, allSchemaDesc()); return true; }
  if (path === "/api/admin/gen/trace" && req.method === "GET") { json(200, { trace: genTraceSnapshot() }); return true; }
  if (path === "/api/admin/combat/trace" && req.method === "GET") { json(200, { trace: judgeTraceSnapshot() }); return true; }
  if (path === "/api/admin/gen/test" && req.method === "POST") {
    const body = await readBody(req);
    if (body === null) { json(400, { error: "invalid JSON" }); return true; }
    const { type: rawType, ...rest } = body || {};
    const type = String(rawType || "monster");
    const opts = { ...rest, dryRun: true };
    let result = null;
    try {
      if (type === "monster") result = await generateMonster(opts);
      else if (type === "item") result = await generateItem(opts);
      else if (type === "biome") result = await generateBiome(opts);
      else if (type === "tile") result = await generateTile(opts);
      else { json(400, { error: `unknown type: ${type}` }); return true; }
    } catch (e) { json(500, { error: String((e && e.message) || e) }); return true; }
    if (!result) { json(503, { error: "generation unavailable (AI disabled, a generation is in flight, or it failed)" }); return true; }
    json(200, { type, result });
    return true;
  }
  if (path === "/api/admin/gen/save" && req.method === "POST") {
    const body = await readBody(req);
    if (body === null) { json(400, { error: "invalid JSON" }); return true; }
    const { type, result } = body || {};
    if (!result || typeof result !== "object") { json(400, { error: "missing result object" }); return true; }
    try {
      let ok = false;
      if (type === "monster") ok = await saveGeneratedMonster(result);
      else if (type === "item") ok = await saveGeneratedItem(result);
      else if (type === "biome") ok = await saveGeneratedBiome(result);
      else if (type === "tile") ok = await saveGeneratedTile(result);
      else { json(400, { error: `unknown type: ${type}` }); return true; }
      if (!ok) { json(409, { error: "not saved (invalid shape or duplicate name/id)" }); return true; }
      json(200, { ok: true, type });
    } catch (e) { json(500, { error: String((e && e.message) || e) }); return true; }
    return true;
  }
  if (path === "/api/admin/gen/queue" && req.method === "GET") { json(200, genQueue.status()); return true; }
  if (path === "/api/admin/gen/queue" && req.method === "POST") {
    const body = await readBody(req);
    if (body === null) { json(400, { error: "invalid JSON" }); return true; }
    const { type, count, ...opts } = body || {};
    const wantEndless = count === "endless" || count === true;
    const r = genQueue.enqueue(String(type || "monster"), wantEndless ? "endless" : count, opts);
    if (r && r.error) { json(400, r); return true; }
    json(200, { ok: true, ...r, status: genQueue.status() });
    return true;
  }
  if (path === "/api/admin/gen/queue/control" && req.method === "POST") {
    const body = await readBody(req);
    if (body === null) { json(400, { error: "invalid JSON" }); return true; }
    const { action, concurrency } = body || {};
    if (action === "pause") genQueue.pause();
    else if (action === "resume") genQueue.resume();
    else if (action === "clear") genQueue.clear();
    if (concurrency != null) genQueue.setConcurrency(concurrency);
    json(200, { ok: true, status: genQueue.status() });
    return true;
  }
  if (path === "/api/admin/schemadesc" && req.method === "POST") {
    const body = await readBody(req);
    if (body === null) { json(400, { error: "invalid JSON" }); return true; }
    json(200, { ok: true, schemaDesc: await setSchemaDesc(body) });
    return true;
  }
  if (path === "/api/admin/genconfig" && req.method === "GET") { json(200, allGenConfig()); return true; }
  if (path === "/api/admin/genconfig" && req.method === "POST") {
    const body = await readBody(req);
    if (body === null) { json(400, { error: "invalid JSON" }); return true; }
    json(200, { ok: true, genconfig: await setGenConfig(body) });
    return true;
  }
  if (path === "/api/admin/genschedule" && req.method === "GET") { json(200, allGenSchedule()); return true; }
  if (path === "/api/admin/genschedule" && req.method === "POST") {
    const body = await readBody(req);
    if (body === null) { json(400, { error: "invalid JSON" }); return true; }
    json(200, { ok: true, genschedule: await setGenSchedule(body) });
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
  // Wipe a category only when its flag === true; omitted flags must preserve data.
  if (path === "/api/admin/wipe" && req.method === "POST") {
    const body = (await readBody(req)) || {};
    const wiped = {};
    if (body.monsters === true) { wiped.monsters = await wipeMonsterTypes().catch(() => 0); clearMonsterTypes(); }
    if (body.items === true) { wiped.items = await wipeItems().catch(() => 0); clearItems(); }
    if (body.tiles === true) { wiped.tiles = await wipeGroundTiles().catch(() => 0); clearGeneratedTiles(); }
    if (body.biomes === true) { wiped.biomes = await wipeBiomes().catch(() => 0); clearBiomes(); }
    if (body.profiles === true) { wiped.profiles = await wipeAllProfiles().catch(() => 0); }
    console.log("[admin] WIPE", JSON.stringify(wiped));
    json(200, { ok: true, wiped, pool: getMonsterTypes().length, items: getItems().length });
    return true;
  }
  if (path === "/api/admin/monsters/generate" && req.method === "POST") {
    const mt = await generateMonster({}).catch(() => null);
    if (mt) json(200, { ok: true, monster: mt });
    else json(502, { error: "generation failed (AI off or error)" });
    return true;
  }
  if (path === "/api/admin/monsters/remove" && req.method === "POST") {
    const body = await readBody(req);
    const ok = body?.name ? await removeMonster(body.name).catch(() => false) : false;
    json(200, { ok });
    return true;
  }
  if (path === "/api/admin/items" && req.method === "GET") { json(200, { items: getItems() }); return true; }
  if (path === "/api/admin/items/generate" && req.method === "POST") {
    const it = await generateItem().catch(() => null);
    if (it) json(200, { ok: true, item: it });
    else json(502, { error: "generation failed (AI off or error)" });
    return true;
  }
  if (path === "/api/admin/items/remove" && req.method === "POST") {
    const body = await readBody(req);
    json(200, { ok: body?.name ? await removeGenItem(body.name).catch(() => false) : false });
    return true;
  }
  if (path === "/api/admin/biomes" && req.method === "GET") { json(200, { biomes: getBiomes() }); return true; }
  if (path === "/api/admin/biomes/generate" && req.method === "POST") {
    const body = (await readBody(req)) || {};
    const opts = {};
    if (typeof body.kind === "string" && body.kind.trim()) opts.kind = body.kind.trim().slice(0, 120);
    const b = await generateBiome(opts).catch(() => null);
    if (b) json(200, { ok: true, biome: b });
    else json(502, { error: "generation failed (AI off or error)" });
    return true;
  }
  if (path === "/api/admin/biomes/remove" && req.method === "POST") {
    const body = await readBody(req);
    json(200, { ok: body?.name ? await removeGenBiome(body.name).catch(() => false) : false });
    return true;
  }
  if (path === "/api/admin/tiles" && req.method === "GET") { json(200, { tiles: getGroundTiles().filter((t) => t.generated) }); return true; }
  if (path === "/api/admin/tiles/generate" && req.method === "POST") {
    const body = (await readBody(req)) || {};
    const opts = {};
    if (typeof body.biome === "string" && body.biome.trim()) opts.biome = body.biome.trim().slice(0, 40);
    if (typeof body.kind === "string" && body.kind.trim()) opts.kind = body.kind.trim().slice(0, 120);
    if (body.collidable != null && body.collidable !== "") opts.collidable = body.collidable;
    const t = await generateTile(opts).catch(() => null);
    if (t) json(200, { ok: true, tile: t });
    else json(502, { error: "generation failed (AI off or error)" });
    return true;
  }
  if (path === "/api/admin/tiles/remove" && req.method === "POST") {
    const body = await readBody(req);
    json(200, { ok: body?.name ? await removeGenTile(body.name).catch(() => false) : false });
    return true;
  }
  json(404, { error: "not found" });
  return true;
}
