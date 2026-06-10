// Lobby → Inventory: screenshot the Chains and Items tabs. Then back → Settings.
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
await page.mouse.click(640, 130); await sleep(2500); // → lobby
// Inventory/Team (left col index 0).
await page.mouse.click(230, 150 + 28 + 24 + 23); await sleep(2200);
await shot("it-0-monsters");
// Tab centers (roster.js tabRects): Monsters (68,28), Chains (169,28), Items (255,28).
await page.mouse.click(169, 28); await sleep(900); await shot("it-1-chains");
await page.mouse.click(255, 28); await sleep(900); await shot("it-2-items");
// Back (top-right) → lobby → Settings (right column, ~x1050 y100).
await page.mouse.click(1235, 28); await sleep(1800);
await page.mouse.click(1050, 200); await sleep(1800); await shot("it-3-settings");
await browser.close();
console.log("done");
