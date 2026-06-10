// Open Cosmetics → "Player Character" tab and screenshot the body-model grid (cloak
// swaps + the 4 distinct figures: knight/mage/automaton/wisp) to audit their render.
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
// Cosmetics station (left column index 5).
const leftX = 230, stationY = (i) => 150 + 28 + 24 + 23 + i * 58;
await page.mouse.click(leftX, stationY(5)); await sleep(2400);
await shot("ccos-0-chains");
// "Player Character" tab — second pill at top (tabRect(1): x≈216+93, y≈72+17).
await page.mouse.click(309, 89); await sleep(1200);
await shot("ccos-1-characters");
// Also a narrow-portrait pass to check the model grid reflow.
await page.setViewportSize({ width: 390, height: 844 }); await sleep(1500);
await shot("ccos-2-characters-narrow");
await browser.close();
console.log("done");
