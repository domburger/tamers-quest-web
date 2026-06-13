// Orchestrate a WORLD seed: generate biomes, THEN tiles for every biome, in one pass (additive — does
// NOT wipe). This is the ordering the world generator needs (TQ-159): a biome only renders as a
// DISTINCT region once it has ground tiles referencing its name (else mapgen's WFC falls back to the
// all-tiles pool and the region has no identity). So Phase 1 seeds biomes, Phase 2 then seeds tiles for
// EVERY live biome — built-in BIOME_DEFS ∪ the just-generated ones. Composes gen-batch-biomes.mjs
// (TQ-158) + gen-batch-tiles.mjs (TQ-147). Admin token injected by `railway run`, never printed.
//
//   railway run --service web -- node tools/gen-batch-world.mjs            (default 6 biomes, 3 tiles/biome)
//   railway run --service web -- node tools/gen-batch-world.mjs 6 4        (6 biomes, 4 tiles each)
//   DRY_RUN=1 node tools/gen-batch-world.mjs 6 4                           (print the plan, no network)
//
// Env: ADMIN_TOKEN (required unless DRY_RUN), BASE (default https://tamersquest.com), DRY_RUN.
import { BIOME_DEFS } from "../src/engine/mapgen.js"; // built-in biome baseline (server imports it too → node-safe)

const TOKEN = process.env.ADMIN_TOKEN;
const BASE = (process.env.BASE || "https://tamersquest.com").replace(/\/$/, "");
const DRY = !!process.env.DRY_RUN;
const BIOMES_N = Math.max(0, Math.min(100, parseInt(process.argv[2] || "6", 10)));
const TILES_PER = Math.max(1, Math.min(20, parseInt(process.argv[3] || "3", 10) || 3));
const hdr = { "content-type": "application/json", "x-admin-token": TOKEN };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (DRY) {
  const builtin = BIOME_DEFS.map((b) => b.name);
  console.log(`[gen-batch-world] DRY RUN — Phase 1: generate ${BIOMES_N} biome(s); Phase 2: generate ${TILES_PER} tile(s) for EACH live biome.`);
  console.log(`  built-in biomes (${builtin.length}): ${builtin.join(", ")}`);
  console.log(`  Phase 2 covers built-ins + any generated biomes; ~${(builtin.length + BIOMES_N) * TILES_PER} tiles total (excl. existing).`);
  console.log(`  ordering: biomes ALWAYS before their tiles, so each region pools its own ground.`);
  process.exit(0);
}
if (!TOKEN) { console.error("no ADMIN_TOKEN (run via railway run, or use DRY_RUN=1)"); process.exit(1); }

async function req(method, path, body) {
  try {
    const r = await fetch(BASE + path, { method, headers: hdr, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
  } catch (e) { return { status: 0, body: String((e && e.message) || e) }; }
}
const biomeCount = async () => { const r = await req("GET", "/api/admin/biomes"); return Array.isArray(r.body?.biomes) ? r.body.biomes.length : -1; };
async function tilesByBiome() {
  const r = await req("GET", "/api/admin/tiles");
  const list = Array.isArray(r.body?.tiles) ? r.body.tiles : null;
  if (!list) return null;
  const by = new Map();
  for (const t of list) by.set(t.biome, (by.get(t.biome) || 0) + 1);
  return by;
}
async function liveBiomeNames() {
  const names = new Set(BIOME_DEFS.map((b) => b.name));
  const r = await req("GET", "/api/biomes");
  if (Array.isArray(r.body)) for (const b of r.body) if (b && b.name) names.add(b.name);
  return [...names];
}

const ABORT_FAILS = 30; // give up if generation is durably broken (rate-limit storm / AI down)
let grandFails = 0;
const backoffStep = (b) => Math.min(60000, b ? b * 2 : 5000);

// ── Phase 1: biomes ──────────────────────────────────────────────────────────────────────────────
// SINGLE-STREAM ONLY (two concurrent runs trip the OpenAI account rate limit → the server 502s).
if (BIOMES_N > 0) {
  const startB = await biomeCount();
  if (startB < 0) { console.error("[gen-batch-world] could not read biome pool — aborting"); process.exit(1); }
  const targetB = startB + BIOMES_N;
  console.log(`[gen-batch-world] Phase 1: biomes ${startB} → ${targetB} (+${BIOMES_N})`);
  let have = startB, attempts = 0, backoff = 0;
  const CAP = BIOMES_N * 4 + 20;
  while (have < targetB && attempts < CAP && grandFails < ABORT_FAILS) {
    attempts++;
    const g = await req("POST", "/api/admin/biomes/generate", {});
    const before = have; const c = await biomeCount(); if (c >= 0) have = c;
    if ((g.status === 200 && g.body?.ok) || have > before) {
      grandFails = grandFails > 0 ? grandFails : 0; backoff = 0;
      console.log(`  ok  biome ${have}/${targetB}` + (g.body?.biome ? ` — ${g.body.biome.name}` : ""));
      await sleep(1200);
    } else {
      grandFails++; backoff = backoffStep(backoff);
      console.log(`  ..  biome attempt ${attempts}: ${g.status} — backoff ${backoff / 1000}s (fail ${grandFails}/${ABORT_FAILS})`);
      await sleep(backoff);
    }
  }
}

// ── Phase 2: tiles for EVERY live biome (built-ins + the ones just generated) ──────────────────────
if (grandFails < ABORT_FAILS) {
  const biomes = await liveBiomeNames();
  const before = await tilesByBiome();
  if (!before) { console.error("[gen-batch-world] could not read tile pool — aborting Phase 2"); process.exit(1); }
  console.log(`[gen-batch-world] Phase 2: ${biomes.length} live biome(s), +${TILES_PER} tile(s) each`);
  for (const biome of biomes) {
    const startN = before.get(biome) || 0;
    const target = startN + TILES_PER;
    let have = startN, attempts = 0, backoff = 0;
    const CAP = TILES_PER * 4 + 8;
    while (have < target && attempts < CAP && grandFails < ABORT_FAILS) {
      attempts++;
      const g = await req("POST", "/api/admin/tiles/generate", { biome });
      const beforeHave = have; const by = await tilesByBiome(); if (by) have = by.get(biome) || 0;
      if ((g.status === 200 && g.body?.ok) || have > beforeHave) {
        backoff = 0;
        console.log(`  ok  ${biome} ${have}/${target}` + (g.body?.tile ? ` — ${g.body.tile.name}` : ""));
        await sleep(1000);
      } else {
        grandFails++; backoff = backoffStep(backoff);
        console.log(`  ..  ${biome} attempt ${attempts}: ${g.status} — backoff ${backoff / 1000}s (fail ${grandFails}/${ABORT_FAILS})`);
        await sleep(backoff);
      }
    }
    if (grandFails >= ABORT_FAILS) break;
  }
}

const aborted = grandFails >= ABORT_FAILS;
console.log(`[gen-batch-world] ${aborted ? "ABORTED on sustained failures (rate limit / AI down)" : "DONE"} — biomes then tiles seeded. Next: visual QA (TQ-160).`);
process.exit(aborted ? 1 : 0);
