// One-shot PROD maintenance (user request 2026-06-11): clear the PLAYER + CHARACTER + ITEM +
// MONSTER databases, then generate 5 fresh monsters with the generation algorithm. Runs against
// the LIVE server's admin HTTP API (the server owns the only reachable Postgres — a local
// `railway run` gets an UNREACHABLE *.railway.internal DATABASE_URL, so DB ops must go through
// the live API). The admin token is injected by `railway run`, never printed.
//
//   railway run --service web -- node tools/wipe-reseed-prod.mjs
//
// Env: ADMIN_TOKEN (required, injected), BASE (default https://tamersquest.com), COUNT (default 5).
const TOKEN = process.env.ADMIN_TOKEN;
const BASE = (process.env.BASE || "https://tamersquest.com").replace(/\/$/, "");
const COUNT = Math.max(1, Math.min(20, parseInt(process.env.COUNT || "5", 10) || 5));
if (!TOKEN) { console.error("no ADMIN_TOKEN (run via: railway run --service web -- node tools/wipe-reseed-prod.mjs)"); process.exit(1); }

const hdr = { "content-type": "application/json", "x-admin-token": TOKEN };
// Distinct element + silhouette + rarity per slot so the 5-monster seed spans the range.
const THEMES = [
  { element: "Fire", biome: "molten cavern", archetype: "brute", rarity: 3 },
  { element: "Water", biome: "drowned trench", archetype: "leviathan", rarity: 4 },
  { element: "Nature", biome: "fungal hollow", archetype: "arthropod", rarity: 2 },
  { element: "Electric", biome: "storm-wracked spire", archetype: "raptor", rarity: 3 },
  { element: "Ice", biome: "frozen vault", archetype: "beast", rarity: 5 },
];

async function post(path, body) {
  const r = await fetch(BASE + path, { method: "POST", headers: hdr, body: JSON.stringify(body || {}) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}

console.log(`[wipe-reseed] BASE=${BASE} count=${COUNT}`);

// 1) WIPE — player + character (profiles+accounts), items, and monsters. Leave tiles/biomes alone
//    (the user asked only for player/character/item/monster). profiles:true is the explicit opt-in
//    to the irreversible player-data wipe; it clears both the in-memory pools and the DB rows.
const w = await post("/api/admin/wipe", { monsters: true, items: true, tiles: false, biomes: false, profiles: true });
console.log("wipe:", w.status, JSON.stringify(w.body));
if (w.status !== 200) { console.error("[wipe-reseed] wipe failed — aborting"); process.exit(1); }

// 2) GENERATE 5 fresh monsters via the generation algorithm (each → pool → DB, with the
//    standardized idle/walk/attack animation set stamped on by normalizeGeneratedMonster).
let made = 0;
for (let i = 0; i < COUNT; i++) {
  const theme = THEMES[i % THEMES.length];
  const g = await post("/api/admin/monsters/generate", theme);
  if (g.status === 200 && g.body && g.body.ok) {
    made++;
    const m = g.body.monster;
    console.log(`  [${i + 1}/${COUNT}] ` + JSON.stringify({ name: m.typeName, element: m.element, rarity: m.rarity, shapes: (m.model?.shapes || []).length, animations: m.animations, attacks: (m.genAttacks || []).map((a) => a.title) }));
  } else {
    console.log(`  [${i + 1}/${COUNT}] FAIL ${g.status} ${JSON.stringify(g.body)}`);
  }
}
console.log(`[wipe-reseed] generated + persisted ${made}/${COUNT} monster(s)`);
process.exit(made === COUNT ? 0 : 1);
