// Generate a BATCH of N AI biomes into the PROD pool via the admin HTTP API (additive — does NOT
// wipe). Sibling of gen-batch-prod.mjs (monsters) / gen-batch-tiles.mjs (tiles): AI generation often
// exceeds Railway's edge proxy window → a 502 even though the server FINISHES + persists, so
// completion is measured by POOL GROWTH (re-GET the biome count after every attempt) and retried with
// exponential backoff. Admin token injected by `railway run`, never printed. (TQ-158, child of TQ-111.)
//
//   railway run --service web -- node tools/gen-batch-biomes.mjs        (default N=8)
//   railway run --service web -- node tools/gen-batch-biomes.mjs 12
//   DRY_RUN=1 node tools/gen-batch-biomes.mjs                           (print the plan, no network)
//
// Env: ADMIN_TOKEN (required unless DRY_RUN), BASE (default https://tamersquest.com), DRY_RUN, TARGET
// (absolute final pool size; else grow by N from the current count).
//
// NOTE: a biome only renders as a DISTINCT region once it has ground tiles referencing it (else
// mapgen's WFC falls back to the all-tiles pool). After seeding biomes, run gen-batch-tiles.mjs so the
// new biomes get tiles (see TQ-159 orchestration).
const TOKEN = process.env.ADMIN_TOKEN;
const BASE = (process.env.BASE || "https://tamersquest.com").replace(/\/$/, "");
const DRY = !!process.env.DRY_RUN;
const N = Math.max(1, Math.min(100, parseInt(process.argv[2] || "8", 10) || 8));
const hdr = { "content-type": "application/json", "x-admin-token": TOKEN };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (DRY) {
  console.log(`[gen-batch-biomes] DRY RUN — would generate ${N} biome(s) via POST /api/admin/biomes/generate`);
  console.log(`  base=${BASE} (override with BASE=...), measured by GET /api/admin/biomes pool growth`);
  console.log(`  reminder: follow with gen-batch-tiles.mjs so the new biomes get tiles (TQ-159).`);
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
async function count() {
  const r = await req("GET", "/api/admin/biomes");
  return Array.isArray(r.body?.biomes) ? r.body.biomes.length : -1;
}

const start = await count();
if (start < 0) { console.error("[gen-batch-biomes] could not read pool count — aborting"); process.exit(1); }
// TARGET sets an ABSOLUTE final pool size (concurrency-safe); else grow by N from the current count.
const target = process.env.TARGET ? Math.max(start, parseInt(process.env.TARGET, 10) || start + N) : start + N;
const work = Math.max(0, target - start);
console.log(`[gen-batch-biomes] start pool=${start}, target ${target} (need +${work})`);

let attempts = 0, have = start, fails = 0, backoff = 0;
const CAP = work * 4 + 20;
const ABORT_FAILS = 30; // give up if generation is durably broken (rate-limit storm / AI down)
// SINGLE-STREAM ONLY: two concurrent runs double the OpenAI request rate and trip the account limit
// (the server then 502s nearly everything). Exponential backoff rides out transient 429 windows.
while (have < target && attempts < CAP && fails < ABORT_FAILS) {
  attempts++;
  const g = await req("POST", "/api/admin/biomes/generate", {}); // server applies its own diversity seed
  const beforeHave = have;
  const c = await count();
  if (c >= 0) have = c;
  if ((g.status === 200 && g.body?.ok) || have > beforeHave) {
    fails = 0; backoff = 0;
    const b = g.body?.biome;
    console.log(`  ok  pool=${have}/${target}` + (b ? ` — ${JSON.stringify({ name: b.name, rarity: b.rarity, element: b.element || "" })}` : " (landed via re-count)"));
    await sleep(1200);
  } else {
    fails++;
    backoff = Math.min(60000, backoff ? backoff * 2 : 5000);
    console.log(`  ..  attempt ${attempts}: ${g.status} ${(typeof g.body === "string" ? g.body : JSON.stringify(g.body)).slice(0, 60)} — backoff ${backoff / 1000}s (fail ${fails}/${ABORT_FAILS})`);
    await sleep(backoff);
  }
}
const ok = have >= target;
console.log(`[gen-batch-biomes] ${ok ? "DONE" : "STOPPED"}: pool grew ${start} → ${have} (+${have - start}) in ${attempts} attempt(s)${fails >= ABORT_FAILS ? " — ABORTED on sustained failures (rate limit / AI down)" : ""}`);
console.log(`[gen-batch-biomes] next: run gen-batch-tiles.mjs so the new biomes get ground tiles (TQ-159).`);
process.exit(ok ? 0 : 1);
