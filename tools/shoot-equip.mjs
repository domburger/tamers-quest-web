// Verify the cosmetics EQUIP is functional: open Cosmetics (Spirit Chains), click a different
// free chain (Ember Coil, card 1) and confirm the EQUIPPED badge moves to it.
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
await page.mouse.click(640, 130); await sleep(2500);      // → lobby
const leftX = 230, stationY = (i) => 150 + 28 + 24 + 23 + i * 58;
await page.mouse.click(leftX, stationY(5)); await sleep(2400); // Cosmetics
await shot("eq-0-initial");
// Card 1 (Ember Coil) center: gridX0=29, x=29+248=277, +CARD_W/2=392; y=122+CARD_H/2=227.
await page.mouse.click(392, 227); await sleep(600);
await shot("eq-1-equipped");
await browser.close();
console.log("done");
