// Verify the chest-open FX actually FIRES (the level-up burst was dead code from a wrong data
// source — apply the same rigor here). Inject a chest near the player, then make it vanish from
// net.state.chests within 56px → the diff should emit the "Chest opened!" sparkle + floater.
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
await page.mouse.click(230, 190); await sleep(900);
await page.mouse.click(640, 300); await sleep(6000);
const ready = await page.evaluate(() => !!(globalThis.__net?.state?.self && globalThis.__net.state.seed != null));
console.log("in world:", ready);
if (!ready) { await shot("co-notinworld"); await browser.close(); process.exit(0); }
await page.mouse.click(640, 360); await sleep(1200); // dismiss onboarding (tap, no walk)
// Phase 1: a chest ~30px from the player (inside the 56px open gate). Re-fire the vanish each
// cycle: getter alternates between [chest] and [] so prevChests!==curChests detects it vanish.
await page.evaluate(() => {
  const s = globalThis.__net.state;
  let on = true;
  Object.defineProperty(s, "chests", { configurable: true,
    get() { on = !on; return on && s.self ? [{ x: s.self.x + 24, y: s.self.y - 14 }] : []; }, set() {} });
});
await sleep(300); await shot("co-0");
await sleep(180); await shot("co-1");
await browser.close();
console.log("done");
