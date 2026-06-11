// Top up the PROD monster pool to TARGET via the admin HTTP API, retrying past the Railway
// edge's 502 timeouts (AI monster generation can exceed the proxy's response window even though
// the server finishes + persists). Re-checks the live count between attempts so a 502 that
// actually landed isn't double-counted. Admin token injected by `railway run`, never printed.
//
//   railway run --service web -- node tools/topup-monsters-prod.mjs
//
// Env: ADMIN_TOKEN (required), BASE (default https://tamersquest.com), TARGET (default 5).
const TOKEN = process.env.ADMIN_TOKEN;
const BASE = (process.env.BASE || "https://tamersquest.com").replace(/\/$/, "");
const TARGET = Math.max(1, Math.min(20, parseInt(process.env.TARGET || "5", 10) || 5));
if (!TOKEN) { console.error("no ADMIN_TOKEN (run via railway run)"); process.exit(1); }
const hdr = { "content-type": "application/json", "x-admin-token": TOKEN };

const THEMES = [
  { element: "Fire", biome: "molten cavern", archetype: "brute", rarity: 3 },
  { element: "Nature", biome: "fungal hollow", archetype: "arthropod", rarity: 2 },
  { element: "Ice", biome: "frozen vault", archetype: "beast", rarity: 5 },
  { element: "Poison", biome: "toxic mire", archetype: "saurian", rarity: 3 },
  { element: "Arcane", biome: "shattered sanctum", archetype: "raptor", rarity: 4 },
];

async function req(method, path, body) {
  try {
    const r = await fetch(BASE + path, { method, headers: hdr, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
  } catch (e) { return { status: 0, body: String(e && e.message || e) }; }
}
async function count() {
  const r = await req("GET", "/api/admin/monsters");
  return Array.isArray(r.body?.generated) ? r.body.generated.length : 0;
}

let have = await count();
console.log(`[topup] start: pool has ${have}, target ${TARGET}`);
let attempts = 0, ti = 0;
while (have < TARGET && attempts < 40) {
  attempts++;
  const theme = THEMES[ti++ % THEMES.length];
  const g = await req("POST", "/api/admin/monsters/generate", theme);
  if (g.status === 200 && g.body?.ok) {
    const m = g.body.monster;
    console.log(`  +OK ${JSON.stringify({ name: m.typeName, element: m.element, rarity: m.rarity, animations: m.animations })}`);
  } else {
    // A 502/timeout MAY still have persisted — re-check the live count before retrying so we
    // don't overshoot the target.
    console.log(`  .. attempt ${attempts}: ${g.status} ${typeof g.body === "string" ? g.body.slice(0, 60) : JSON.stringify(g.body).slice(0, 80)}`);
  }
  have = await count();
  console.log(`     pool now ${have}`);
}
console.log(`[topup] done: pool has ${have} (target ${TARGET}) after ${attempts} attempt(s)`);
process.exit(have >= TARGET ? 0 : 1);
