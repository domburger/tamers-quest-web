// Lobby → Inventory → tap a team monster to open the INSPECT detail panel; screenshot it
// at desktop AND narrow portrait (the two-column stats block is prone to overflow on phones).
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
await page.mouse.click(230, 225); await sleep(2400);       // Inventory/Team (left col index 0)
await shot("ri-0-grid");
await page.mouse.click(394, 150); await sleep(900);        // tap first team monster → inspect (desktop)
await shot("ri-1-desktop");
// Narrow: resize (scene restarts → inspect closes), then tap the first team monster.
await page.setViewportSize({ width: 390, height: 844 }); await sleep(1500);
await page.mouse.click(53, 150); await sleep(900);
await shot("ri-2-narrow");
await browser.close();
console.log("done");
