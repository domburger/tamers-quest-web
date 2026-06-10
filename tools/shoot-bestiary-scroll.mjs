// Reach the in-game Bestiary and scroll through it, capturing the procedural monster
// art across all ~115 species to spot any that render badly (malformed / invisible / odd).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8080";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log("shot:", n); };
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(8000);
await page.click("#guestBtn"); await sleep(600);
await page.fill("#guest-nick", "Scout"); await page.click("#guest-go"); await sleep(2200);
await page.mouse.click(640, 720 - 80); await sleep(1200);
await page.fill('input[placeholder="Character name"]', "Scout"); await sleep(300);
await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2200);
await page.mouse.click(640, 130); await sleep(2500);   // → lobby
await page.mouse.click(230, 457); await sleep(2500);    // Bestiary station
// Scroll through the grid, capturing each page. Use the down arrow (held) to scroll.
for (let p = 0; p < 7; p++) {
  await shot(`bs-${String(p).padStart(2, "0")}`);
  await page.keyboard.down("ArrowDown"); await sleep(1400); await page.keyboard.up("ArrowDown"); await sleep(400);
}
await browser.close();
console.log("done");
