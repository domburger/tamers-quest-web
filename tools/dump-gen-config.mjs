// Dump the LIVE (prod) admin overrides for the generation pipeline: prompt overrides
// (settings id=2), AI config (id=3), and schema-field descriptions (id=4). Run via:
//   railway run --service web -- node tools/dump-gen-config.mjs
// so DATABASE_URL is injected. Read-only.
import { initDb, dbEnabled, loadPrompts, loadAiConfig, loadSchemaDesc } from "../server/db.js";

await initDb();
if (!dbEnabled()) { console.log("NO DB (DATABASE_URL unset)"); process.exit(0); }

const prompts = await loadPrompts();
const aiconfig = await loadAiConfig();
const schemaDesc = await loadSchemaDesc();

console.log("=== PROMPT OVERRIDES (settings id=2) ===");
const pk = Object.keys(prompts || {});
if (!pk.length) console.log("(none — all prompts are the code defaults)");
for (const k of pk) console.log(`\n--- ${k} ---\n${prompts[k]}`);

console.log("\n\n=== AI CONFIG OVERRIDES (settings id=3) ===");
console.log(JSON.stringify(aiconfig || {}, null, 2));

console.log("\n=== SCHEMA-DESC OVERRIDES (settings id=4) ===");
console.log(JSON.stringify(schemaDesc || {}, null, 2));

process.exit(0);
