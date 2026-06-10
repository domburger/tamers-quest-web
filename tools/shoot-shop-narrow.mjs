// Lobby → Spirit Shop / Base Upgrades, resize to a narrow phone, screenshot each to verify
// the row reflow (taller rows, buttons under full-width text) actually holds with real data.
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
// Spirit Shop (left col index 1).
await page.mouse.click(230, 283); await sleep(2200);
await page.setViewportSize({ width: 360, height: 800 }); await sleep(1500);
await shot("sn-shop");
// Back → lobby → Base Upgrades (index 2).
await page.setViewportSize({ width: 1280, height: 720 }); await sleep(800);
await page.mouse.click(1235, 28); await sleep(1600);
await page.mouse.click(230, 341); await sleep(2200);
await page.setViewportSize({ width: 360, height: 800 }); await sleep(1500);
await shot("sn-baseupgrades");
await browser.close();
console.log("done");
