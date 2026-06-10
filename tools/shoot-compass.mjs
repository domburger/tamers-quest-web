// Inject a portal at varying distances/positions (getter override) to verify the portal
// compass: (1) shows a cyan arrow + tile-distance toward an OFF-SCREEN portal, (2) the
// behaviour when the portal is in the GUTTER band (off the square but within screen bounds).
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
if (!ready) { await shot("cmp-notinworld"); await browser.close(); process.exit(0); }
await page.mouse.click(640, 360); await sleep(1000);
// FAR off-screen portal (far right): compass should show a cyan arrow + distance on the right.
await page.evaluate(() => {
  const s = globalThis.__net.state;
  Object.defineProperty(s, "portals", { configurable: true, get() { return s.self ? [{ x: s.self.x + 2000, y: s.self.y - 600 }] : []; }, set() {} });
});
await sleep(900); await shot("cmp-far");
// GUTTER-BAND portal: ~430 world-units right of the player → screen ~ W/2+430 = 1070, which in
// landscape (square x:[280,1000]) is in the RIGHT GUTTER (off the square) but < W-margin(1226),
// so the screen-bounds check would HIDE the compass even though the portal isn't visible.
await page.evaluate(() => {
  const s = globalThis.__net.state;
  Object.defineProperty(s, "portals", { configurable: true, get() { return s.self ? [{ x: s.self.x + 430, y: s.self.y }] : []; }, set() {} });
});
await sleep(900); await shot("cmp-gutter");
await browser.close();
console.log("done");
