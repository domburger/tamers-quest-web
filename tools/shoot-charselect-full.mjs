// Create several guest characters with VARYING name lengths, then screenshot the populated
// character-select list (multiple cards, team previews, stats) at desktop + narrow portrait.
// Stresses the real-data layout the empty-state never exercises.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8080";
mkdirSync(".screenshots", { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
const shot = async (n) => { await page.screenshot({ path: `.screenshots/${n}.png` }); console.log("shot:", n); };
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(8000);
await page.click("#guestBtn"); await sleep(600);
await page.fill("#guest-nick", "Scout"); await page.click("#guest-go"); await sleep(2500);
// Now on character-select (empty). Create N characters via "+ New Character".
const names = ["Aria", "Bartholomew the Bold", "Cy"]; // short / max-length / tiny
for (const nm of names) {
  await page.mouse.click(640, 720 - 64); await sleep(1100);           // + New Character
  await page.fill('input[placeholder="Character name"]', nm); await sleep(250);
  await page.press('input[placeholder="Character name"]', "Enter"); await sleep(1600);
}
await shot("csf-desktop");
await page.setViewportSize({ width: 360, height: 740 }); await sleep(1200);
await shot("csf-narrow");
await browser.close();
console.log("done");
