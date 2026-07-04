// Generate a BATCH of N monsters into the PROD pool via the admin HTTP API (additive — does NOT
// wipe). AI generation often exceeds Railway's edge proxy window → a 502 "Application failed to
// respond" even though the server FINISHES + persists. So completion is measured by POOL GROWTH
// (re-GET the count after every attempt), retrying until the pool grows by N. Admin token injected
// by `railway run`, never printed.
//
//   railway run --service web -- node tools/gen-batch-prod.mjs            (default N=50)
//   railway run --service web -- node tools/gen-batch-prod.mjs 50
//
// Env: ADMIN_TOKEN (required), BASE (default https://tamersquest.com).
const TOKEN = process.env.ADMIN_TOKEN;
const BASE = (process.env.BASE || "https://tamersquest.com").replace(/\/$/, "");
const N = Math.max(1, Math.min(200, parseInt(process.argv[2] || "50", 10) || 50));
if (!TOKEN) { console.error("no ADMIN_TOKEN (run via railway run)"); process.exit(1); }
const hdr = { "content-type": "application/json", "x-admin-token": TOKEN };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A diverse theme matrix so the batch spans the element wheel, silhouettes, and rarities.
const ELEMENTS = ["Fire", "Water", "Nature", "Electric", "Ice", "Poison", "Metal", "Arcane", "Shadow", "Light"];
const ARCHETYPES = ["brute", "leviathan", "arthropod", "raptor", "beast", "saurian", "serpent", "avian", "construct", "spirit"];
const BIOMES = ["molten cavern", "drowned trench", "fungal hollow", "storm spire", "frozen vault", "toxic mire", "rusted foundry", "shattered sanctum", "umbral grotto", "sunlit gallery"];
function theme(i) {
  return { element: ELEMENTS[i % ELEMENTS.length], archetype: ARCHETYPES[i % ARCHETYPES.length], biome: BIOMES[i % BIOMES.length], rarity: 1 + (i % 5) };
}

async function req(method, path, body) {
  try {
    const r = await fetch(BASE + path, { method, headers: hdr, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
  } catch (e) { return { status: 0, body: String(e && e.message || e) }; }
}
async function count() {
  const r = await req("GET", "/api/admin/monsters");
  return Array.isArray(r.body?.generated) ? r.body.generated.length : -1;
}

const start = await count();
if (start < 0) { console.error("[gen-batch] could not read pool count — aborting"); process.exit(1); }
// TARGET (env) sets an ABSOLUTE final pool size; else grow by N from the current count. Absolute
// targeting is concurrency-safe: two runs both growing the same pool toward (different) absolute
// targets converge monotonically without the delta-mode double-counting that makes them stop early.
const target = process.env.TARGET ? Math.max(start, parseInt(process.env.TARGET, 10) || start + N) : start + N;
const work = Math.max(0, target - start);
console.log(`[gen-batch] start pool=${start}, target ${target} (need +${work})`);

let attempts = 0, have = start, fails = 0, backoff = 0;
const CAP = work * 4 + 30; // generous headroom for backoff re-tries + occasional hard builder failures
const ABORT_FAILS = 30;    // give up if generation is durably broken (rate-limit storm / AI down)
// SINGLE-STREAM ONLY: running two of these at once doubles the OpenAI request rate and trips the
// account rate limit → the server returns 502 "generation failed" for nearly everything. Keep it to
// one batch; exponential backoff below rides out any transient 429 window instead of hammering.
while (have < target && attempts < CAP && fails < ABORT_FAILS) {
  attempts++;
  const g = await req("POST", "/api/admin/monsters/generate", theme(attempts));
  const beforeHave = have;
  const c = await count();
  if (c >= 0) have = c;
  if ((g.status === 200 && g.body?.ok) || have > beforeHave) {
    // Success (or a 502 that still landed → pool grew). Reset backoff; gentle inter-request pace.
    fails = 0; backoff = 0;
    const m = g.body?.monster;
    console.log(`  ok  pool=${have}/${target}` + (m ? ` ${JSON.stringify({ name: m.typeName, element: m.element, rarity: m.rarity, shapes: (m.model?.shapes || []).length })}` : " (landed via re-count)"));
    await sleep(1200);
  } else {
    // Failure that did NOT grow the pool — likely an OpenAI rate limit. Exponential backoff (5→60s)
    // so we stop adding load and let the limit window reset; reset on the next success.
    fails++;
    backoff = Math.min(60000, backoff ? backoff * 2 : 5000);
    console.log(`  ..  attempt ${attempts}: ${g.status} ${(typeof g.body === "string" ? g.body : JSON.stringify(g.body)).slice(0, 60)} — backoff ${backoff / 1000}s (fail ${fails}/${ABORT_FAILS})`);
    await sleep(backoff);
  }
  if (attempts % 5 === 0) console.log(`     [progress] pool=${have}/${target} after ${attempts} attempt(s)`);
}
const ok = have >= target;
console.log(`[gen-batch] ${ok ? "DONE" : "STOPPED"}: pool grew ${start} → ${have} (+${have - start}) in ${attempts} attempt(s)${fails >= ABORT_FAILS ? " — ABORTED on sustained failures (rate limit / AI down)" : ""}`);
process.exit(ok ? 0 : 1);
