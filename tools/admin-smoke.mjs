// Smoke-test the admin zone: load /admin.html, connect with ADMIN_TOKEN, and confirm the
// prompt editor now renders EVERY AI prompt (v2 monster pipeline stages + v2 judge + items),
// the items panel is shown, and all AI settings inputs are present.
// Run with the token injected (never printed): railway run --service web -- node tools/admin-smoke.mjs
import { chromium } from "playwright";
const TOKEN = process.env.ADMIN_TOKEN;
if (!TOKEN) { console.error("no ADMIN_TOKEN"); process.exit(1); }
const URL = process.env.ADMIN_URL || "https://tamersquest.com/admin.html";
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.goto(URL, { waitUntil: "domcontentloaded" });
await p.fill("#token", TOKEN);
await p.click("#load");
await p.waitForFunction(() => document.querySelectorAll("#promptFields textarea").length > 0, { timeout: 20000 });
const info = await p.evaluate(() => {
  const tas = [...document.querySelectorAll("#promptFields textarea")].map((t) => t.id.replace(/^pr_/, ""));
  return {
    promptCount: tas.length,
    keys: tas,
    aiSettingInputs: document.querySelectorAll("#promptPanel [id^=ai_]").length,
    itemPanelVisible: getComputedStyle(document.getElementById("itemPanel")).display !== "none",
  };
});
await b.close();
const need = ["combatSystem", "combatJudgeV2System", "monsterSystem", "monsterUser",
  "genIdeaSystem", "genIdeaUser", "genAttributesSystem", "genAttributesUser",
  "genModelSystem", "genModelUser", "genReviewSystem", "genReviewUser",
  "itemIdeaSystem", "itemIdeaUser", "itemDesignerSystem", "itemDesignerUser"];
const missing = need.filter((k) => !info.keys.includes(k));
console.log("prompts rendered:", info.promptCount, "| AI setting inputs:", info.aiSettingInputs, "| items panel:", info.itemPanelVisible);
console.log("missing required prompts:", missing.length ? missing.join(", ") : "(none)");
const ok = missing.length === 0 && info.aiSettingInputs >= 10 && info.itemPanelVisible;
console.log(ok ? "PASS: all AI prompts + settings + items available in the admin zone" : "FAIL");
process.exit(ok ? 0 : 1);
