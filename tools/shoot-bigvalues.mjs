// Stress-test large data values: inject max gold/essence (server caps at 1e7 = 8 digits)
// and big lifetime stats, then check the shop currency header + results LIFETIME line for
// overflow, at wide and 360.
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
await page.mouse.click(230, 283); await sleep(2500);    // Spirit Shop station
// Inject max currency (the shop reads net.state live each frame).
await page.evaluate(() => { globalThis.__net.state.gold = 10000000; globalThis.__net.state.essence = 9876543; });
await sleep(500); await shot("bv-00-shop-wide");
await page.setViewportSize({ width: 360, height: 800 }); await sleep(600);
await page.evaluate(() => { globalThis.__net.state.gold = 10000000; globalThis.__net.state.essence = 9876543; });
await sleep(400); await shot("bv-01-shop-360");
await browser.close();
console.log("done");
