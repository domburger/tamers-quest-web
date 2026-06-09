// Generate N AI items through the live pipeline + print them, to inspect quality/behaviour.
// Run: OPENAI_API_KEY=... node tools/gen-items.mjs [N] [model]
import { readFileSync } from "node:fs";
import { setGameData, getItems } from "../src/engine/gamedata.js";
import { initPrompts } from "../server/prompts.js";
import { initAiConfig, setAiConfig } from "../server/aiconfig.js";
import { buildItemInspirationPrompt, buildItemDesignerPrompt } from "../server/genItems.js";
import { generateItem } from "../server/content.js";

const N = Math.max(1, parseInt(process.argv[2] || "5", 10) || 5);
const MODEL = process.argv[3] || "";
const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
setGameData({ monsterTypes: read("monstertype.json"), attacks: read("attacks.json"), groundTiles: read("groundtiles.json"), items: read("item.json") });
await Promise.all([initPrompts(), initAiConfig()]);
if (MODEL) await setAiConfig({ model: MODEL });
if (!process.env.OPENAI_API_KEY) { console.error("no OPENAI_API_KEY"); process.exit(1); }

console.log("inspiration prompt:", JSON.stringify(buildItemInspirationPrompt()).slice(0, 200));
console.log("designer prompt:", JSON.stringify(buildItemDesignerPrompt("smoking tar bomb")).slice(0, 260), "\n");

void getItems;
for (let i = 0; i < N; i++) {
  // generateItem applies the variety seed (random role) + adds to the in-memory pool.
  const it = await generateItem().catch((e) => { console.error("gen:", e.message); return null; });
  if (it) console.log(`  [${i + 1}] ${JSON.stringify(it)}`);
  else console.log(`  [${i + 1}] FAILED`);
}
process.exit(0);
