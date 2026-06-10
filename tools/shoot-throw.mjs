// Reach the world and throw a spirit chain (Space), capturing rapid frames to examine the
// aim telegraph, throw wind-up, and the projectile/boomerang in flight.
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
await page.mouse.click(640, 130); await sleep(2500);
await page.mouse.click(230, 150); await sleep(900);
await page.mouse.click(640, 300); await sleep(6000);
const ready = await page.evaluate(() => !!(globalThis.__net?.state?.self && globalThis.__net.state.seed != null));
console.log("in world:", ready);
if (!ready) { await shot("throw-notinworld"); await browser.close(); process.exit(0); }
// Dismiss onboarding + face a direction (so the throw aims somewhere with room).
await page.keyboard.down("KeyD"); await sleep(500); await page.keyboard.up("KeyD"); await sleep(500);
await shot("throw-00-aim"); // the persistent aim telegraph (pre-throw)
// Throw (Space) and capture rapid frames to catch the wind-up + projectile.
await page.keyboard.press("Space");
for (let i = 0; i < 6; i++) { await sleep(160); await shot(`throw-${i + 1}`); }
await browser.close();
console.log("done");
