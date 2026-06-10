// Audit ULTRAWIDE (2560x720, aspect 3.56): menus reflow (lobby 3-column spreads wide),
// in-game gets huge side gutters. Reach states at 1280x720, then resize to ultrawide
// (canvas scenes re-render on resize).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8080";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
const UW = { width: 2560, height: 720 };
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log("shot:", n); };
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(8000);
await page.click("#guestBtn"); await sleep(600);
await page.fill("#guest-nick", "Scout"); await page.click("#guest-go"); await sleep(2200);
// character-select at ultrawide
await page.setViewportSize(UW); await sleep(900); await shot("uw-00-charselect");
await page.setViewportSize({ width: 1280, height: 720 }); await sleep(700);
await page.mouse.click(640, 720 - 80); await sleep(1200);
await page.fill('input[placeholder="Character name"]', "Scout"); await sleep(300);
await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2200);
await page.mouse.click(640, 130); await sleep(2500);   // → lobby
await page.setViewportSize(UW); await sleep(900); await shot("uw-01-lobby");
await page.setViewportSize({ width: 1280, height: 720 }); await sleep(700);
// in-game at ultrawide
await page.mouse.click(230, 150); await sleep(900);
await page.mouse.click(640, 300); await sleep(6000);
const ready = await page.evaluate(() => !!(globalThis.__net?.state?.self && globalThis.__net.state.seed != null));
console.log("in world:", ready);
if (ready) {
  await page.keyboard.down("KeyD"); await sleep(400); await page.keyboard.up("KeyD"); await sleep(500);
  await page.setViewportSize(UW); await sleep(1200); await shot("uw-02-game");
}
await browser.close();
console.log("done");
