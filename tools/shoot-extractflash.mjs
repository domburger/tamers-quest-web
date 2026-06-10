// Inject an "extracted" roundResult and capture WITHIN the 0.6s extract-flash window to verify
// the celebratory white-out renders over the result card (the win-condition moment).
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
await page.fill("#guest-nick", "Scout"); await page.click("#guest-go"); await sleep(2200);
await page.mouse.click(640, 720 - 80); await sleep(1200);
await page.fill('input[placeholder="Character name"]', "Scout"); await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2200);
await page.mouse.click(640, 130); await sleep(2500);
await page.mouse.click(230, 150); await sleep(900);
await page.mouse.click(640, 300); await sleep(6000);
const ready = await page.evaluate(() => !!(globalThis.__net?.state?.self && globalThis.__net.state.seed != null));
console.log("in world:", ready);
if (!ready) { await shot("xf-notinworld"); await browser.close(); process.exit(0); }
await page.mouse.click(640, 360); await sleep(800);
await page.evaluate(() => {
  globalThis.__net.state.roundResult = { outcome: "extracted", reason: "extracted", gains: { caught: 2, xpGained: 300, levelUps: 1, survivedS: 240 } };
});
await sleep(120); await shot("xf-0"); // ~early flash (p~0.2)
await sleep(160); await shot("xf-1"); // ~mid flash (p~0.45)
await sleep(500); await shot("xf-2"); // after flash → settled result card
await browser.close();
console.log("done");
