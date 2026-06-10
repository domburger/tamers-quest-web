// Reach the game world and roam, capturing clean world frames (tiles, lighting/fog,
// biomes, player movement) to examine the actual in-game rendering quality.
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
if (!ready) { await shot("we-notinworld"); await browser.close(); process.exit(0); }
// Dismiss onboarding, then roam in a long sweep, capturing frames + the biome each time.
await page.keyboard.down("KeyD"); await sleep(300); await page.keyboard.up("KeyD"); await sleep(600);
const biome = () => page.evaluate(() => globalThis.__net?.state?.biomeName || "?");
const dirs = ["KeyD", "KeyW", "KeyA", "KeyS", "KeyD", "KeyW"];
for (let i = 0; i < dirs.length; i++) {
  // hold each direction a while to cover ground (cross biome boundaries)
  await page.keyboard.down(dirs[i]); await sleep(2200); await page.keyboard.up(dirs[i]); await sleep(400);
  const pos = await page.evaluate(() => { const s = globalThis.__net?.state?.self; return s ? `${Math.round(s.x)},${Math.round(s.y)}` : "?"; });
  console.log(`frame ${i}: pos=${pos}`);
  await shot(`we-${i}`);
}
await browser.close();
console.log("done");
