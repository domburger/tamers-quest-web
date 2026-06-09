// Reseed the PROD monster pool via the admin HTTP API — the LIVE server runs the generation
// and persists to its own (internal) Postgres, so this works from anywhere (unlike a local
// `railway run` whose injected DATABASE_URL points at an unreachable *.railway.internal host).
//
// Run with the admin token injected (never printed):
//   railway run --service web -- node tools/reseed-prod.mjs
// Env: ADMIN_TOKEN (required), BASE (default https://tamersquest.com), COUNT (default 5),
//      KEEP_MONSTERS=1 to skip the wipe.
const TOKEN = process.env.ADMIN_TOKEN;
const BASE = (process.env.BASE || "https://tamersquest.com").replace(/\/$/, "");
const COUNT = Math.max(1, Math.min(20, parseInt(process.env.COUNT || "5", 10) || 5));
if (!TOKEN) { console.error("no ADMIN_TOKEN (run via: railway run --service web -- node tools/reseed-prod.mjs)"); process.exit(1); }

const hdr = { "content-type": "application/json", "x-admin-token": TOKEN };
// Distinct element + silhouette + rarity per slot so a seed batch spans the whole range.
const THEMES = [
  { element: "Fire", biome: "molten cavern", archetype: "brute", rarity: 3 },
  { element: "Water", biome: "drowned trench", archetype: "leviathan", rarity: 4 },
  { element: "Nature", biome: "fungal hollow", archetype: "arthropod", rarity: 2 },
  { element: "Electric", biome: "storm-wracked spire", archetype: "raptor", rarity: 3 },
  { element: "Ice", biome: "frozen vault", archetype: "beast", rarity: 5 },
  { element: "Poison", biome: "toxic mire", archetype: "saurian", rarity: 3 },
  { element: "Metal", biome: "rusted foundry", archetype: "brute", rarity: 4 },
  { element: "Arcane", biome: "shattered sanctum", archetype: "raptor", rarity: 4 },
];

async function post(path, body) {
  const r = await fetch(BASE + path, { method: "POST", headers: hdr, body: JSON.stringify(body || {}) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}

console.log(`[reseed-prod] BASE=${BASE} count=${COUNT}`);
if (process.env.KEEP_MONSTERS !== "1") {
  const w = await post("/api/admin/wipe", { monsters: true, items: false, profiles: false });
  console.log("wipe:", w.status, JSON.stringify(w.body));
  if (w.status !== 200) { console.error("[reseed-prod] wipe failed — aborting"); process.exit(1); }
}

let made = 0;
for (let i = 0; i < COUNT; i++) {
  const theme = THEMES[i % THEMES.length];
  const g = await post("/api/admin/monsters/generate", theme);
  if (g.status === 200 && g.body && g.body.ok) {
    made++;
    const m = g.body.monster;
    console.log(`  [${i + 1}/${COUNT}] ` + JSON.stringify({ name: m.typeName, element: m.element, rarity: m.rarity, bodyShape: m.model?.bodyShape, palette: m.model?.palette, features: m.model?.features, attacks: (m.genAttacks || []).map((a) => a.title) }));
  } else {
    console.log(`  [${i + 1}/${COUNT}] FAIL ${g.status} ${JSON.stringify(g.body)}`);
  }
}
console.log(`[reseed-prod] generated + persisted ${made}/${COUNT} monster(s)`);
process.exit(made === COUNT ? 0 : 1);
