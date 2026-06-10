// Reach the world (WITHOUT walking into combat — tap to dismiss onboarding), let prevLevels
// seed, then repeatedly bump a team monster's level via a tight interval. The snapshot resets
// it each tick, so the prevLevels diff re-fires the level-up burst continuously (gold particles
// + "<name> Lv N" floater at the player) — easy to capture vs the one-shot bump.
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
if (!ready) { await shot("lu-notinworld"); await browser.close(); process.exit(0); }
await page.mouse.click(640, 360); await sleep(1400); // tap dismisses onboarding (no walking → no combat); let prevLevels seed
await page.evaluate(() => {
  let n = 0;
  globalThis.__lu = setInterval(() => {
    const t = globalThis.__net?.state?.team; // full active-team (id/level/name)
    if (t && t[0]) t[0].level = (n++ % 2 === 0) ? 1 : 7; // toggle → re-fire the increase-diff each cycle
  }, 90);
});
await sleep(400); await shot("lu-0");
await sleep(220); await shot("lu-1");
await sleep(220); await shot("lu-2");
await browser.close();
console.log("done");
