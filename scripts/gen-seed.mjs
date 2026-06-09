// One-off prod content seeder: generate N AI monsters + M AI items via the admin API.
// Run with the prod env injected so ADMIN_TOKEN is present (never printed):
//   railway run --service web -- node scripts/gen-seed.mjs [monsters] [items]
// Each monster uses the v2 pipeline (genAttacks + visualDescription). Retries on transient
// AI failures up to a cap; reports each result. Idempotent-ish (dedupes by name server-side).
const BASE = process.env.SEED_BASE || "https://tamersquest.com";
const TOKEN = process.env.ADMIN_TOKEN;
const NM = Number(process.argv[2] || 5);
const NI = Number(process.argv[3] || 5);
if (!TOKEN) { console.error("no ADMIN_TOKEN in env"); process.exit(1); }

async function post(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 120000); // 120s per generation (v2 = a few LLM calls)
  try {
    const r = await fetch(BASE + path, {
      method: "POST",
      headers: { "x-admin-token": TOKEN, "Content-Type": "application/json" },
      signal: ctrl.signal,
    });
    return await r.json();
  } catch (e) {
    return { error: String(e && e.message || e) };
  } finally { clearTimeout(t); }
}

async function run(path, key, target, maxAttempts) {
  const out = [];
  let attempts = 0;
  while (out.length < target && attempts < maxAttempts) {
    attempts++;
    const r = await post(path);
    const obj = r && r[key];
    if (obj) {
      out.push(obj);
      const label = obj.typeName ? `${obj.typeName} [${obj.element}] rarity ${obj.rarity} · genAttacks ${(obj.genAttacks || []).length}` : obj.name;
      console.log(`  ${key} ${out.length}/${target}: ${label}`);
    } else {
      console.log(`  ${key} attempt ${attempts} failed: ${(r && r.error) || "no " + key}`);
      await new Promise((s) => setTimeout(s, 1500));
    }
  }
  return out;
}

console.log(`Seeding ${NM} monsters + ${NI} items on ${BASE} …`);
const monsters = await run("/api/admin/monsters/generate", "monster", NM, NM + 6);
const items = await run("/api/admin/items/generate", "item", NI, NI + 6);
console.log(`DONE: ${monsters.length}/${NM} monsters, ${items.length}/${NI} items`);
if (monsters.length < NM || items.length < NI) process.exit(2);
