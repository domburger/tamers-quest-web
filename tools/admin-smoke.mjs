// Smoke-test the admin zone: connect with ADMIN_TOKEN and confirm the tabbed layout, that
// EVERY AI prompt + EVERY schema field description + all settings render and are editable,
// and that tab switching works. Run with the token injected (never printed):
//   railway run --service web -- node tools/admin-smoke.mjs   (or ADMIN_URL=http://localhost:PORT/admin)
import { chromium } from "playwright";
const TOKEN = process.env.ADMIN_TOKEN;
if (!TOKEN) { console.error("no ADMIN_TOKEN"); process.exit(1); }
const URL = process.env.ADMIN_URL || "https://tamersquest.com/admin.html";
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.goto(URL, { waitUntil: "domcontentloaded" });
await p.fill("#token", TOKEN);
await p.click("#load");
await p.waitForFunction(() => document.querySelectorAll(".prompt-field").length > 0, { timeout: 20000 });

const info = await p.evaluate(() => ({
  prompts: [...document.querySelectorAll(".prompt-field")].map((t) => t.dataset.key),
  promptsFilled: [...document.querySelectorAll(".prompt-field")].filter((t) => t.value.trim()).length,
  schema: [...document.querySelectorAll(".sd-field")].map((t) => t.dataset.key),
  schemaFilled: [...document.querySelectorAll(".sd-field")].filter((t) => t.value.trim()).length,
  tabs: [...document.querySelectorAll(".tab-btn")].map((b) => b.dataset.tab),
  aiSettingInputs: document.querySelectorAll("[id^=ai_]").length,
  hasGen: !!document.getElementById("gen1"),
  hasItem: !!document.getElementById("genItem1"),
}));

// Tab switching: click Combat, confirm its pane shows and the asset pane hides.
await p.click('.tab-btn[data-tab="combat"]');
const tabSwitch = await p.evaluate(() => getComputedStyle(document.getElementById("pane-combat")).display !== "none"
  && getComputedStyle(document.getElementById("pane-assetgen")).display === "none");
await b.close();

const needPrompts = ["combatSystem","combatJudgeV2System","monsterSystem","monsterUser",
  "genIdeaSystem","genIdeaUser","genAttributesSystem","genAttributesUser",
  "genModelSystem","genModelUser","genReviewSystem","genReviewUser",
  "itemIdeaSystem","itemIdeaUser","itemDesignerSystem","itemDesignerUser"];
const needSchema = ["idea.inspiration","attributes.attacks","attributes.visualDescription","attributes.baseStat","model.bodyShape","review.changes"];
const missP = needPrompts.filter((k) => !info.prompts.includes(k));
const missS = needSchema.filter((k) => !info.schema.includes(k));

console.log("tabs:", info.tabs.join(", "));
console.log("prompts:", info.prompts.length, "(filled", info.promptsFilled + ") | missing:", missP.join(",") || "none");
console.log("schema descriptions:", info.schema.length, "(filled", info.schemaFilled + ") | missing:", missS.join(",") || "none");
console.log("AI setting inputs:", info.aiSettingInputs, "| gen panel:", info.hasGen, "| item panel:", info.hasItem, "| tab switch works:", tabSwitch);

const ok = missP.length === 0 && missS.length === 0 && info.schema.length >= 18
  && info.promptsFilled === info.prompts.length && info.schemaFilled === info.schema.length
  && info.tabs.join(",") === "assetgen,combat,game,ops" && info.aiSettingInputs >= 10
  && info.hasGen && info.hasItem && tabSwitch;
console.log(ok ? "PASS: tabs + all prompts + all schema descriptions + settings editable" : "FAIL");
process.exit(ok ? 0 : 1);
