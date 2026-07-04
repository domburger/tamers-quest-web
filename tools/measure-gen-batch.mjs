// Measure the REAL per-monster OpenAI cost of the live generation pipeline using the ACTUAL
// per-phase prod models (Idea/Attributes = gpt-5.4-mini, Builder = gpt-5.4), then project the cost
// of a batch of BATCH monsters. Captures per-call {model, in, out} so mini vs builder are priced
// separately. Run: railway run --service web -- node tools/measure-gen-batch.mjs [N] [BATCH]
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes } from "../src/engine/gamedata.js";
import { initPrompts } from "../server/prompts.js";
import { initAiConfig, getAiConfig } from "../server/aiconfig.js";
import { initSchemaDesc } from "../server/schemaDesc.js";
import { aiGenerateMonsterV2 } from "../server/genStages.js";

const N = Math.max(1, parseInt(process.argv[2] || "3", 10) || 3);
const BATCH = Math.max(1, parseInt(process.argv[3] || "50", 10) || 50);

// $/1M tokens (input, output). gpt-5.x tier pricing the repo's measure tool assumes.
const PRICE = {
  "gpt-5.4": [1.25, 10],
  "gpt-5.4-mini": [0.15, 0.6],
  "gpt-5.4-nano": [0.05, 0.4],
  "gpt-5.5": [2.5, 15],
};
const priceOf = (m) => PRICE[m] || PRICE["gpt-5.4"]; // unknown → builder-tier (conservative)

const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
setGameData({ monsterTypes: read("monstertype.json"), attacks: read("attacks.json"), groundTiles: read("groundtiles.json"), items: read("item.json") });
await Promise.all([initPrompts(), initAiConfig(), initSchemaDesc()]);
if (!process.env.OPENAI_API_KEY) { console.error("no OPENAI_API_KEY (run via: railway run --service web -- node tools/measure-gen-batch.mjs)"); process.exit(1); }

const calls = []; // { model, in, out }
async function createChat(model, temperature) {
  const { ChatOpenAI } = await import("@langchain/openai");
  const used = model || getAiConfig("genBuilderModel");
  return new ChatOpenAI({
    model: used, temperature, apiKey: process.env.OPENAI_API_KEY,
    callbacks: [{ handleLLMEnd(output) {
      const u = output?.llmOutput?.tokenUsage || {};
      const meta = output?.generations?.[0]?.[0]?.message?.usage_metadata || {};
      calls.push({ model: used, in: u.promptTokens ?? meta.input_tokens ?? 0, out: u.completionTokens ?? meta.output_tokens ?? 0 });
    } }],
  });
}

const THEMES = [
  { element: "Fire", biome: "molten cavern", archetype: "brute" },
  { element: "Water", biome: "drowned trench", archetype: "leviathan" },
  { element: "Nature", biome: "fungal hollow", archetype: "arthropod" },
  { element: "Electric", biome: "storm spire", archetype: "raptor" },
  { element: "Ice", biome: "frozen vault", archetype: "beast" },
];

console.log(`[measure] per-phase models: idea=${getAiConfig("genIdeaModel")} attrs=${getAiConfig("genAttributesModel")} builder=${getAiConfig("genBuilderModel")}; N=${N}`);
const per = [];
for (let i = 0; i < N; i++) {
  const before = calls.length;
  const existingNames = new Set(getMonsterTypes().map((m) => m.typeName));
  const mt = await aiGenerateMonsterV2({ ...THEMES[i % THEMES.length], existingNames }, { createChat }).catch((e) => { console.error("gen:", e.message); return null; });
  const mine = calls.slice(before);
  const cost = mine.reduce((s, c) => { const [pi, po] = priceOf(c.model); return s + (c.in / 1e6) * pi + (c.out / 1e6) * po; }, 0);
  per.push({ cost, in: mine.reduce((s, c) => s + c.in, 0), out: mine.reduce((s, c) => s + c.out, 0), nCalls: mine.length });
  console.log(`  monster ${i + 1}: ${mt ? mt.typeName : "FAIL"} — ${mine.length} calls; ` + mine.map((c) => `${c.model}(in${c.in}/out${c.out})`).join(" ") + ` => $${cost.toFixed(4)} (shapes=${(mt?.model?.shapes || []).length})`);
}

const avg = (k) => per.reduce((s, m) => s + m[k], 0) / per.length;
const aCost = avg("cost"), aIn = Math.round(avg("in")), aOut = Math.round(avg("out")), aCalls = (avg("nCalls")).toFixed(1);
console.log(`\n[measure] AVG/monster: ${aCalls} calls, in=${aIn} out=${aOut} tok, COST $${aCost.toFixed(4)}`);
console.log(`[measure] PROJECTED for a batch of ${BATCH}: $${(aCost * BATCH).toFixed(2)}  (±, generation is non-deterministic)`);
process.exit(0);
