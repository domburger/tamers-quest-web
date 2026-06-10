// Enter the world and roam in a long sweep, screenshotting distinct areas + logging the
// biome under the player, to audit tile/terrain rendering across biomes (seams, missing
// textures, water/edge transitions) — areas beyond the spawn that other harnesses never reach.
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
if (!ready) { await shot("roam-notinworld"); await browser.close(); process.exit(0); }
await page.keyboard.down("KeyD"); await sleep(300); await page.keyboard.up("KeyD"); await sleep(400);
const pos = () => page.evaluate(() => { const s = globalThis.__net?.state; return s?.self ? { x: Math.round(s.self.x), y: Math.round(s.self.y), inC: !!s.combat } : null; });
// Sweep in a few directions, capturing distinct terrain. Move in bursts; if combat starts,
// flee by walking the other way a beat (we want terrain shots, not battles).
const dirs = [["KeyD", 14], ["KeyS", 10], ["KeyA", 14], ["KeyW", 10]];
let shotN = 0;
for (const [key, bursts] of dirs) {
  for (let b = 0; b < bursts; b++) {
    const st = await pos(); if (!st) break;
    if (st.inC) { // bumped a monster — step back out and skip
      const back = key === "KeyD" ? "KeyA" : key === "KeyA" ? "KeyD" : key === "KeyS" ? "KeyW" : "KeyS";
      await page.keyboard.down(back); await sleep(500); await page.keyboard.up(back); await sleep(2500); continue;
    }
    await page.keyboard.down(key); await sleep(420); await page.keyboard.up(key);
    if (b % 4 === 3) { await sleep(250); await shot(`roam-${String(shotN++).padStart(2, "0")}`); const p = await pos(); console.log(`at ${p?.x},${p?.y}`); }
  }
}
await browser.close();
console.log("done");
