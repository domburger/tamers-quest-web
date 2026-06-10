// Audit station/settings headers at a NARROW width (360): enter each at 1280 (reliable
// nav), resize to 360x800, screenshot, resize back, Back to lobby. Checks the
// title / currency / Back-button row for overlap on small screens.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8080";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
const N = { width: 360, height: 800 };
const W = { width: 1280, height: 720 };
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log("shot:", n); };
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(8000);
await page.click("#guestBtn"); await sleep(600);
await page.fill("#guest-nick", "Scout"); await page.click("#guest-go"); await sleep(2200);
await page.mouse.click(640, 720 - 80); await sleep(1200);
await page.fill('input[placeholder="Character name"]', "Scout"); await sleep(300);
await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2200);
await page.mouse.click(640, 130); await sleep(2500);          // → lobby

// [name, enter-click, back-click] — stations Back is top-right; settings Back top-left.
const targets = [
  ["nh-shop",   [230, 283],  [1235, 28]],
  ["nh-base",   [230, 341],  [1235, 28]],
  ["nh-bestiary",[230, 457], [1235, 28]],
  ["nh-cosmetics",[230, 515],[1235, 28]],
  ["nh-settings",[1050, 200],[60, 34]],
];
for (const [name, enter, back] of targets) {
  await page.mouse.click(enter[0], enter[1]); await sleep(2200);
  await page.setViewportSize(N); await sleep(1000); await shot(name);
  await page.setViewportSize(W); await sleep(700);
  await page.mouse.click(back[0], back[1]); await sleep(2000);
}
await browser.close();
console.log("done");
