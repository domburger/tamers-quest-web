// Generate a BATCH of AI floor tiles into the PROD pool via the admin HTTP API (additive — does NOT
// wipe), one batch PER BIOME so every biome the world generator draws from gets a cohesive set of
// ground types. Sibling of tools/gen-batch-prod.mjs (monsters): AI generation often exceeds Railway's
// edge proxy window → a 502 even though the server FINISHES + persists, so completion is measured by
// POOL GROWTH (re-GET the tile count after every attempt) and retried with exponential backoff.
// Admin token injected by `railway run`, never printed. (TQ-147, child of TQ-110.)
//
//   railway run --service web -- node tools/gen-batch-tiles.mjs            (default 3 tiles / biome)
//   railway run --service web -- node tools/gen-batch-tiles.mjs 5          (5 tiles / biome)
//   DRY_RUN=1 node tools/gen-batch-tiles.mjs                               (print the plan, no network)
//
// Env: ADMIN_TOKEN (required unless DRY_RUN), BASE (default https://tamersquest.com), DRY_RUN.
import { BIOME_DEFS } from "../src/engine/mapgen.js"; // built-in biome baseline (server imports this too → node-safe)

const TOKEN = process.env.ADMIN_TOKEN;
const BASE = (process.env.BASE || "https://tamersquest.com").replace(/\/$/, "");
const DRY = !!process.env.DRY_RUN;
const PER_BIOME = Math.max(1, Math.min(20, parseInt(process.argv[2] || "3", 10) || 3));
const hdr = { "content-type": "application/json", "x-admin-token": TOKEN };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, path, body) {
  try {
    const r = await fetch(BASE + path, { method, headers: hdr, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
  } catch (e) { return { status: 0, body: String((e && e.message) || e) }; }
}
// All generated tiles (the admin pool lists only generated, not seed) — count per biome by filtering.
async function tilesByBiome() {
  const r = await req("GET", "/api/admin/tiles");
  const list = Array.isArray(r.body?.tiles) ? r.body.tiles : null;
  if (!list) return null;
  const by = new Map();
  for (const t of list) by.set(t.biome, (by.get(t.biome) || 0) + 1);
  return by;
}
// The FULL biome list a tile can pool under = built-in BIOME_DEFS ∪ generated biomes (/api/biomes).
async function allBiomeNames() {
  const names = new Set(BIOME_DEFS.map((b) => b.name));
  const r = await req("GET", "/api/biomes");
  if (Array.isArray(r.body)) for (const b of r.body) if (b && b.name) names.add(b.name);
  return [...names];
}

if (DRY) {
  // Offline plan: prove the script + the BIOME_DEFS import load, list what a real run would target.
  const builtin = BIOME_DEFS.map((b) => b.name);
  console.log(`[gen-batch-tiles] DRY RUN — would generate ${PER_BIOME} tile(s) for each biome.`);
  console.log(`  built-in biomes (${builtin.length}): ${builtin.join(", ")}`);
  console.log(`  (+ any generated biomes from GET /api/biomes at run time)`);
  console.log(`  total tiles for the built-in set alone: ~${builtin.length * PER_BIOME}`);
  process.exit(0);
}

if (!TOKEN) { console.error("no ADMIN_TOKEN (run via railway run, or use DRY_RUN=1)"); process.exit(1); }

const biomes = await allBiomeNames();
const before = await tilesByBiome();
if (!before) { console.error("[gen-batch-tiles] could not read tile pool — aborting"); process.exit(1); }
const startTotal = [...before.values()].reduce((a, b) => a + b, 0);
console.log(`[gen-batch-tiles] ${biomes.length} biome(s), target +${PER_BIOME}/biome; tile pool starts at ${startTotal}`);

const ABORT_FAILS = 30; // give up if generation is durably broken (rate-limit storm / AI down)
let grandFails = 0;
// SINGLE-STREAM ONLY: two concurrent runs double the OpenAI request rate and trip the account limit
// (the server then 502s nearly everything). Exponential backoff rides out transient 429 windows.
for (const biome of biomes) {
  const startN = (before.get(biome) || 0);
  const target = startN + PER_BIOME;
  let have = startN, attempts = 0, fails = 0, backoff = 0;
  const CAP = PER_BIOME * 4 + 8;
  while (have < target && attempts < CAP && grandFails < ABORT_FAILS) {
    attempts++;
    const g = await req("POST", "/api/admin/tiles/generate", { biome }); // server picks a diverse {kind}
    const beforeHave = have;
    const by = await tilesByBiome();
    if (by) have = by.get(biome) || 0;
    if ((g.status === 200 && g.body?.ok) || have > beforeHave) {
      fails = 0; backoff = 0;
      const t = g.body?.tile;
      console.log(`  ok  ${biome} ${have}/${target}` + (t ? ` — ${JSON.stringify({ name: t.name, collidable: t.collidable })}` : " (landed via re-count)"));
      await sleep(1000);
    } else {
      fails++; grandFails++;
      backoff = Math.min(60000, backoff ? backoff * 2 : 5000);
      console.log(`  ..  ${biome} attempt ${attempts}: ${g.status} ${(typeof g.body === "string" ? g.body : JSON.stringify(g.body)).slice(0, 60)} — backoff ${backoff / 1000}s (fail ${grandFails}/${ABORT_FAILS})`);
      await sleep(backoff);
    }
  }
  if (grandFails >= ABORT_FAILS) break;
}
const after = await tilesByBiome();
const endTotal = after ? [...after.values()].reduce((a, b) => a + b, 0) : startTotal;
const aborted = grandFails >= ABORT_FAILS;
console.log(`[gen-batch-tiles] ${aborted ? "ABORTED on sustained failures (rate limit / AI down)" : "DONE"}: tile pool ${startTotal} → ${endTotal} (+${endTotal - startTotal})`);
process.exit(aborted ? 1 : 0);
