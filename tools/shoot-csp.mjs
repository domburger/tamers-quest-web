// CSP verification (LS-10). Loads the served client against a server running the
// CSP in ENFORCING mode and reports any Content-Security-Policy violations as it
// walks the title → single-player flow. Used to confirm the policy is clean before
// the prod header is flipped from Report-Only to enforcing.
//
//   npm run build
//   PORT=8095 CSP_ENFORCE=true SERVE_STATIC=true node server/index.js &
//   GAME_URL=http://localhost:8095 node tools/shoot-csp.mjs
//
// Exit/log: "CSP violations: N" + each message (N must be 0 to enforce safely).

import { chromium } from "playwright";

const URL = process.env.GAME_URL || "http://localhost:8095";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isCsp = (s) => /content security policy|refused to (load|apply|execute|connect)/i.test(s || "");

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const violations = [];
page.on("console", (m) => { if (isCsp(m.text())) violations.push(m.text()); });
page.on("pageerror", (e) => { if (isCsp(e.message)) violations.push(e.message); });

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(4500); // fonts + sprite gen + the inline boot script

// Walk title → character select → new character → lobby (exercises styles, fonts,
// the bundle, the inline boot script, manifest/icons, and the WS connect attempt).
await page.keyboard.press("Enter"); await sleep(1500);
await page.mouse.click(640, 720 - 80); await sleep(1000);
await page.keyboard.type("CSPcheck", { delay: 50 }); await sleep(400);
await page.keyboard.press("Enter"); await sleep(1500);
await page.mouse.click(640, 130); await sleep(2500);
await page.click('button:has-text("Multiplayer")').catch(() => {}); // also hit the DOM title buttons
await sleep(1500);

console.log("CSP violations:", violations.length);
for (const v of violations) console.log("  -", v.slice(0, 200));
await browser.close();
console.log("done");
