// Reach the roster (Inventory/Team) and tap a team monster to open its INSPECT detail
// panel (real stats / description / catch-feasibility / Field-Store-Release actions).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8080";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
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
await page.mouse.click(230, 215); await sleep(2500);    // Inventory/Team station
await shot("insp-00-roster");
// Tap the first active-team card (top row, centered cluster ~x410 at 1280).
await page.mouse.click(410, 140); await sleep(1000);
await shot("insp-01-detail");
// Arm Release (two-step) to capture the danger state.
await page.mouse.click(640, 560); await sleep(500);
await shot("insp-02-release-arm");
await browser.close();
console.log("done");
