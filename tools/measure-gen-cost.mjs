// Measure the real OpenAI token usage of ONE monster generation (Idea + Attributes + Builder,
// + any builder retries). Runs N generations and reports avg input/output tokens per monster so
// cost = tokens × price. Run: OPENAI_API_KEY=... node tools/measure-gen-cost.mjs [N] [model]
import { readFileSync } from "node:fs";
import { setGameData, getMonsterTypes } from "../src/engine/gamedata.js";
import { initPrompts } from "../server/prompts.js";
import { initAiConfig, getAiConfig, setAiConfig } from "../server/aiconfig.js";
import { initSchemaDesc } from "../server/schemaDesc.js";
import { aiGenerateMonsterV2 } from "../server/genStages.js";

const N = Math.max(1, parseInt(process.argv[2] || "3", 10) || 3);
const MODEL = process.argv[3] || "gpt-5.4";

const read = (f) => JSON.parse(readFileSync(`./public/assets/data/${f}`, "utf8"));
setGameData({ monsterTypes: read("monstertype.json"), attacks: read("attacks.json"), groundTiles: read("groundtiles.json"), items: read("item.json") });
await Promise.all([initPrompts(), initAiConfig(), initSchemaDesc()]);
await setAiConfig({ genModelName: MODEL });
if (!process.env.OPENAI_API_KEY) { console.error("no OPENAI_API_KEY"); process.exit(1); }

// A createChat that builds the real ChatOpenAI but attaches a callback capturing per-call usage.
const calls = []; // { in, out }
async function createChat() {
  const { ChatOpenAI } = await import("@langchain/openai");
  return new ChatOpenAI({
    model: getAiConfig("genModelName"),
    temperature: getAiConfig("genTemperature"),
    apiKey: process.env.OPENAI_API_KEY,
    callbacks: [{
      handleLLMEnd(output) {
        const u = output?.llmOutput?.tokenUsage || {};
        const meta = output?.generations?.[0]?.[0]?.message?.usage_metadata || {};
        const i = u.promptTokens ?? meta.input_tokens ?? 0;
        const o = u.completionTokens ?? meta.output_tokens ?? 0;
        calls.push({ in: i, out: o });
      },
    }],
  });
}

const THEMES = [
  { element: "Fire", biome: "molten cavern", archetype: "brute" },
  { element: "Water", biome: "drowned trench", archetype: "leviathan" },
  { element: "Nature", biome: "fungal hollow", archetype: "arthropod" },
  { element: "Electric", biome: "storm spire", archetype: "raptor" },
  { element: "Ice", biome: "frozen vault", archetype: "beast" },
];

console.log(`[measure] model=${MODEL} generations=${N}`);
const perMon = [];
for (let i = 0; i < N; i++) {
  const before = calls.length;
  const existingNames = new Set(getMonsterTypes().map((m) => m.typeName));
  const mt = await aiGenerateMonsterV2({ ...THEMES[i % THEMES.length], existingNames }, { createChat }).catch((e) => { console.error("gen:", e.message); return null; });
  const mine = calls.slice(before);
  const inSum = mine.reduce((s, c) => s + c.in, 0);
  const outSum = mine.reduce((s, c) => s + c.out, 0);
  perMon.push({ in: inSum, out: outSum, nCalls: mine.length });
  console.log(`  monster ${i + 1}: ${mt ? mt.typeName : "FAIL"} — ${mine.length} LLM calls, in=${inSum} out=${outSum} (shapes=${(mt?.model?.shapes || []).length})`);
}

const avg = (k) => Math.round(perMon.reduce((s, m) => s + m[k], 0) / perMon.length);
const ai = avg("in"), ao = avg("out"), ac = avg("nCalls");
console.log(`\n[measure] AVG per monster: ${ac} LLM calls, INPUT ${ai} tok, OUTPUT ${ao} tok, TOTAL ${ai + ao} tok`);
const cost = (pin, pout) => ((ai / 1e6) * pin + (ao / 1e6) * pout).toFixed(4);
console.log("\nCost per monster at various $/1M (input, output):");
for (const [pin, pout, label] of [[1.25, 10, "gpt-5.4-ish (1.25/10)"], [2.5, 10, "gpt-4o (2.5/10)"], [0.15, 0.6, "mini (0.15/0.60)"], [5, 15, "premium (5/15)"]]) {
  console.log(`  ${label}: $${cost(pin, pout)}`);
}
process.exit(0);
