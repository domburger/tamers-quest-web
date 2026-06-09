// Reseed the monster pool through the LIVE multi-agent pipeline (Idea→Attributes→Builder).
// Run with prod env injected:
//   railway run --service web -- node tools/reseed-monsters.mjs --count 2 --dry   # verify, no writes
//   railway run --service web -- node tools/reseed-monsters.mjs --wipe --count 5  # clear + seed 5
// Flags: --count N (default 5), --wipe (clear monster_types first), --wipe-items (also clear
//        generated_items), --dry (generate + print but DO NOT persist or wipe).
// Player profiles are NEVER touched by this tool.
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes } from "../src/engine/gamedata.js";
import { initDb, dbEnabled, wipeMonsterTypes, wipeItems } from "./../server/db.js";
import { initPrompts } from "../server/prompts.js";
import { initAiConfig, getAiConfig } from "../server/aiconfig.js";
import { initSchemaDesc } from "../server/schemaDesc.js";
import { initContent, generateMonster } from "../server/content.js";
import { aiGenerateMonsterV2 } from "../server/genStages.js";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const count = Math.max(1, Math.min(20, parseInt(valOf("--count", "5"), 10) || 5));
const dry = has("--dry");
const wipe = has("--wipe");

// Load static game data (attack pool for assignAttacks + base names for dedup).
const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
setGameData({ monsterTypes: read("monstertype.json"), attacks: read("attacks.json"), groundTiles: read("groundtiles.json"), items: read("item.json") });

await initDb();
await Promise.all([initPrompts(), initAiConfig(), initSchemaDesc()]);
if (dbEnabled() && !dry) await initContent(); // merge existing generated content for accurate dedup

console.log(`[reseed] db=${dbEnabled()} aiKey=${!!process.env.OPENAI_API_KEY} genModel=${getAiConfig("genModel")} model=${getAiConfig("model")} count=${count} dry=${dry} wipe=${wipe}`);
if (!process.env.OPENAI_API_KEY) { console.error("[reseed] no OPENAI_API_KEY — aborting"); process.exit(1); }

if (wipe && !dry) {
  const m = await wipeMonsterTypes().catch((e) => { console.error("wipe monsters:", e.message); return 0; });
  console.log(`[reseed] wiped ${m} monster(s) from the DB`);
  if (has("--wipe-items")) {
    const it = await wipeItems().catch((e) => { console.error("wipe items:", e.message); return 0; });
    console.log(`[reseed] wiped ${it} item(s) from the DB`);
  }
}

const summary = (mt) => ({
  name: mt.typeName, element: mt.element, rarity: mt.rarity, size: mt.size,
  bodyShape: mt.model?.bodyShape, palette: mt.model?.palette,
  features: mt.model?.features, attacks: (mt.genAttacks || []).map((a) => a.title),
});

let made = 0;
for (let i = 0; i < count; i++) {
  const mt = dry
    ? await aiGenerateMonsterV2({ existingNames: new Set(getMonsterTypes().map((m) => m.typeName)) }).catch((e) => { console.error("gen:", e.message); return null; })
    : await generateMonster().catch((e) => { console.error("gen:", e.message); return null; });
  if (!mt) { console.log(`  [${i + 1}/${count}] FAILED`); continue; }
  made++;
  console.log(`  [${i + 1}/${count}] ` + JSON.stringify(summary(mt)));
}
console.log(`[reseed] ${dry ? "generated (not persisted)" : "generated + persisted"} ${made}/${count} monster(s). pool now ${getMonsterTypes().length}`);
process.exit(0);
