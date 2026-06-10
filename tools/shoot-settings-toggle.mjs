// Verify the Settings toggles are INTERACTIVE (functional, not just rendered): click Sound +
// Volume and confirm the state changes. Settings reached via lobby → Settings (right column).
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
await page.mouse.click(1050, 200); await sleep(1800);      // Settings (right column)
await shot("set-0-initial");
await page.mouse.click(712, 176); await sleep(500);        // Sound toggle → Off
await shot("set-1-soundoff");
await page.mouse.click(658, 224); await sleep(400);        // Volume − (×2)
await page.mouse.click(658, 224); await sleep(400);
await shot("set-2-voldown");
await browser.close();
console.log("done");
