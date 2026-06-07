// Temp repro for PT1-T09: drive SP combat to actually RESOLVE A TURN (the
// existing shoot-spcombat.mjs only opens the attack list, never attacks).
import { chromium } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5188";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
let errs = 0;
page.on("pageerror", (e) => { errs++; console.log("PAGEERR:", e.message, "\n", (e.stack||"").split("\n").slice(0,6).join("\n")); });
page.on("console", (m) => { const t = m.text(); if (/error|cannot|undefined|not a function/i.test(t)) console.log("CONSOLE:", t); });
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 20000 });
await sleep(9000);
await page.keyboard.press("Enter"); await sleep(2000);
await page.mouse.click(640, 720 - 80); await sleep(1200);
await page.keyboard.type("QAfighter", { delay: 60 }); await sleep(500);
await page.keyboard.press("Enter"); await sleep(2000);
await page.mouse.click(640, 130); await sleep(2000);
await page.mouse.click(640, 150); await sleep(6000);
console.log("== at world ==");
await page.keyboard.press("0"); await sleep(2500);   // force encounter
console.log("== fight menu ==");
await page.mouse.click(640 - 110, 390); await sleep(1200);  // Fight -> attack list
console.log("== attack list, clicking first attack ==");
await page.mouse.click(640 - 110, 390); await sleep(3000);  // first attack -> doAttack -> evaluateTurn
console.log("== after first attack; clicking again to continue ==");
await page.mouse.click(640 - 110, 390); await sleep(2000);  // continue / next action
await page.mouse.click(640 - 110, 390); await sleep(2000);
console.log("== done, errors:", errs, "==");
await browser.close();
