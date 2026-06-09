// Apply the corrected item-generation prompts to prod LIVE (admin override, no redeploy),
// so item generation works (the previous prompts asked for plain text under json_object mode
// → OpenAI 400). Pulls the fixed defaults straight from server/prompts.js so there's no
// duplication. Run with prod env injected (ADMIN_TOKEN), never printed:
//   railway run --service web -- node scripts/fix-item-prompts.mjs
import { getPrompt } from "../server/prompts.js";
const BASE = process.env.SEED_BASE || "https://tamersquest.com";
const TOKEN = process.env.ADMIN_TOKEN;
if (!TOKEN) { console.error("no ADMIN_TOKEN"); process.exit(1); }
const keys = ["itemIdeaSystem", "itemIdeaUser", "itemDesignerSystem", "itemDesignerUser"];
const body = {};
for (const k of keys) body[k] = getPrompt(k);
const r = await fetch(BASE + "/api/admin/prompts", {
  method: "POST",
  headers: { "x-admin-token": TOKEN, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
console.log("prompts override status:", r.status);
const txt = await r.text();
console.log("ok:", /"ok":true/.test(txt));
