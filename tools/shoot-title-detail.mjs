import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8080";
mkdirSync(".screenshots", { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("#title", { timeout: 15000 });
await sleep(3000);
await page.screenshot({ path: ".screenshots/title-detail.png" });
// also a narrow phone title
await page.setViewportSize({ width: 360, height: 740 }); await sleep(1500);
await page.screenshot({ path: ".screenshots/title-360.png" });
console.log("done");
await browser.close();
