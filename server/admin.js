// Admin panel API (P7). Auth-gated (ADMIN_TOKEN) endpoints to read/edit the
// live-tunable game config and review generated content. Mounted before the
// static handler in index.js. No-op (503) unless ADMIN_TOKEN is set.

import { createHash, timingSafeEqual } from "node:crypto";
import { saveSettings, loadMonsterTypes, wipeMonsterTypes, wipeItems, wipeGroundTiles, wipeBiomes } from "./db.js";
import { getMonsterTypes, getItems, getGroundTiles, getBiomes, clearMonsterTypes, clearItems, clearGeneratedTiles, clearBiomes } from "../src/engine/gamedata.js";
import { generateMonster, removeMonster, generateItem, removeGenItem, generateTile, removeGenTile, generateBiome, removeGenBiome,
  saveGeneratedMonster, saveGeneratedItem, saveGeneratedBiome, saveGeneratedTile, genInFlightState } from "./content.js"; // TQ-216: gen-hub save-to-pool; TQ-317: live in-flight gen state
import { wipeAllProfiles } from "./store.js";
import { allPrompts, setPrompts } from "./prompts.js";
import { allAiConfig, setAiConfig } from "./aiconfig.js";
import { allSchemaDesc, setSchemaDesc } from "./schemaDesc.js";
import { aiEnabled } from "./ai.js"; // so /admin can show whether the OpenAI key is set
import { aiMetricsSnapshot } from "./aiMetrics.js"; // TQ-40: fight-agent health for the stats panel
import { genTraceSnapshot } from "./genStages.js"; // TQ-331: recent per-stage gen inputs/outputs for the admin review panel

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
  salesEnabled: { bool: true }, // TQ-198: real-money sales (Paddle checkout) master kill-switch — default OFF
  baseSpeed: { min: 50, max: 600, int: true },
  stormDps: { min: 0, max: 500, int: true },
  dangerFillS: { min: 5, max: 300, int: true }, // zone-death timer: seconds outside before you die
  dangerDrainS: { min: 1, max: 120, int: true }, // seconds in safety to clear a full danger bar
  encounterRadius: { min: 10, max: 200, int: true },
  hiddenMonsterPct: { min: 0, max: 100, int: true },
  energyRestorePct: { min: 0, max: 100, int: true },
  pvpRadius: { min: 10, max: 200, int: true },
  // Wild-monster approach (cfbf705): documented "admin-tunable" but the validation was missing,
  // so these cfg fields couldn't actually be tuned. Wire them up like the rest.
  monsterApproachPct: { min: 0, max: 100, int: true }, // % of monsters that slowly hunt players
  monsterApproachSpeedFrac: { min: 0, max: 1 }, // approach speed as a fraction of baseSpeed
  monsterApproachRadius: { min: 0, max: 4000, int: true }, // aggro range — how close a hunter notices
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
    fightAgent: aiMetricsSnapshot(), // TQ-40: judge call volume / fallback+timeout rate / latency / alert
    generation: genInFlightState(), // TQ-317: live in-flight content generation — { active, type, startedAt } (or { active:false })
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
  // Schema field descriptions (the structured-output guidance the LLM reads per field).
  if (path === "/api/admin/schemadesc" && req.method === "GET") { json(200, allSchemaDesc()); return true; }
  // TQ-331: gen telemetry — the recent per-stage model inputs (system+user prompt, model id) and raw
  // outputs, so an operator can review exactly what each agent was asked/returned when debugging a bad
  // generation (e.g. a missing name or an off-brief visual). In-memory ring buffer, newest last.
  if (path === "/api/admin/gen/trace" && req.method === "GET") { json(200, { trace: genTraceSnapshot() }); return true; }
  // TQ-213: dry-run TEST generation for the generation hub (TQ-211). Runs the gen pipeline with the
  // CURRENT live settings for the chosen type and RETURNS the generated object WITHOUT writing to the
  // live pool, so the operator can preview/tweak/re-run. Explicit 'save to pool' is a separate action.
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
  // TQ-216: persist a PREVIEWED test generation to the live pool — explicit operator action only.
  // Reuses the same add+upsert path the generate* functions use; 409 on an invalid shape or duplicate.
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
  if (path === "/api/admin/schemadesc" && req.method === "POST") {
    const body = await readBody(req);
    if (body === null) { json(400, { error: "invalid JSON" }); return true; }
    json(200, { ok: true, schemaDesc: await setSchemaDesc(body) });
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
  // Clean wipe (admin) — clear AI-generated content and/or ALL player data, in BOTH the live
  // in-memory pools AND the DB, so the reset is immediate (no restart). Body flags select what:
  //   { monsters?:bool, items?:bool, tiles?:bool, biomes?:bool, profiles?:bool } — ALL default OFF.
  // OPT-IN per category (TQ-244): a category is wiped ONLY when its flag is explicitly === true, so
  // omitting a flag preserves that pool ({monsters:true} clears monsters only — never collateral
  // tiles/biomes loss). An empty body {} wipes nothing.
  if (path === "/api/admin/wipe" && req.method === "POST") {
    const body = (await readBody(req)) || {};
    const wiped = {};
    if (body.monsters === true) { wiped.monsters = await wipeMonsterTypes().catch(() => 0); clearMonsterTypes(); }
    if (body.items === true) { wiped.items = await wipeItems().catch(() => 0); clearItems(); }
    // clearGeneratedTiles keeps the seed tiles (maps still need them); clearBiomes drops only the
    // generated pool (built-in BIOME_DEFS stays).
    if (body.tiles === true) { wiped.tiles = await wipeGroundTiles().catch(() => 0); clearGeneratedTiles(); }
    if (body.biomes === true) { wiped.biomes = await wipeBiomes().catch(() => 0); clearBiomes(); }
    if (body.profiles === true) { wiped.profiles = await wipeAllProfiles().catch(() => 0); }
    console.log("[admin] WIPE", JSON.stringify(wiped));
    json(200, { ok: true, wiped, pool: getMonsterTypes().length, items: getItems().length });
    return true;
  }
  if (path === "/api/admin/monsters/generate" && req.method === "POST") {
    // Optional targeting hints {biome, archetype, rarity}; with none, generation is driven by the
    // Idea agent's inspiration words alone. The pipeline sanitizes hint text, but trim/cap here too.
    // TQ-348: "element" was removed (no such concept in this game) — an element hint is ignored.
    const body = (await readBody(req)) || {};
    const opts = {};
    if (typeof body.biome === "string" && body.biome.trim()) opts.biome = body.biome.trim().slice(0, 40);
    if (typeof body.archetype === "string" && body.archetype.trim()) opts.archetype = body.archetype.trim().slice(0, 16);
    if (body.rarity != null && Number.isFinite(Number(body.rarity))) opts.rarity = Number(body.rarity);
    const mt = await generateMonster(opts).catch(() => null); // generates → pool → DB
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
  // AI items (plan "Decide general items") — mirror the monster curation routes.
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
  // AI biomes (themed map regions) — mirror the monster/item curation routes. Optional {kind}.
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
  // AI floor tiles (ground types within a biome) — mirror the curation routes. Optional {biome, kind}.
  if (path === "/api/admin/tiles" && req.method === "GET") { json(200, { tiles: getGroundTiles().filter((t) => t.generated) }); return true; }
  if (path === "/api/admin/tiles/generate" && req.method === "POST") {
    const body = (await readBody(req)) || {};
    const opts = {};
    if (typeof body.biome === "string" && body.biome.trim()) opts.biome = body.biome.trim().slice(0, 40);
    if (typeof body.kind === "string" && body.kind.trim()) opts.kind = body.kind.trim().slice(0, 120);
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
