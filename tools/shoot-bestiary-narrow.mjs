// Open the bestiary, resize to a NARROW phone, then open a monster detail to audit the
// two-column detail modal at narrow width (the right stats/attacks column is prone to crush).
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
await page.mouse.click(640, 720 - 80); await sleep(1200);
await page.fill('input[placeholder="Character name"]', "Scout"); await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2500);
await page.mouse.click(640, 130); await sleep(2500);       // → lobby
await page.mouse.click(230, 457); await sleep(2400);       // Bestiary
// Resize to narrow phone (scene restarts, grid re-lays out to 1 col).
const W = Number(process.env.PW) || 390, H = Number(process.env.PH) || 844;
await page.setViewportSize({ width: W, height: H }); await sleep(1500);
await shot("bn-0-grid");
// First card center at narrow: x0=(W-210)/2 → center +105; y=HEADER+GAP+CARD_H/2≈164.
await page.mouse.click((W - 210) / 2 + 105, 164); await sleep(1000);
await shot("bn-1-detail");
// Close, scroll DOWN toward the long-description monsters (Dark/Fire/Light/Nature/Water sort
// late), and open one to verify the stats don't overlap a long description.
await page.mouse.click(W / 2, 700); await sleep(500); // tap closes detail
await page.mouse.move(W / 2, 400);
for (let s = 0; s < 40; s++) { await page.mouse.wheel(0, 700); await sleep(45); }
await sleep(600);
await shot("bn-2-scrolled");
await page.mouse.click((W - 210) / 2 + 105, 164); await sleep(1000);
await shot("bn-3-detail-long");
await browser.close();
console.log("done");
