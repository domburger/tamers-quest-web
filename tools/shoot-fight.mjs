// Reach the game world, then roam until a monster encounter triggers, snapping
// frames. Combat is RNG-gated by walking into monsters, so we sweep a while.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.GAME_URL || "http://localhost:8080";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DSF) || 2 });
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log("shot:", n); };

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(5000);
await page.keyboard.press("Enter"); await sleep(1500);
await page.mouse.click(640, 720 - 80); await sleep(1000);
await page.keyboard.type("Scout", { delay: 70 }); await sleep(500);
await page.keyboard.press("Enter"); await sleep(1500);
await page.mouse.click(640, 130); await sleep(2000);          // → lobby
await page.mouse.click(640, 145); await sleep(5000);          // Start Run → world

// Roam: sweep in each direction in turn, snapping frames to catch a fight.
const keys = ["KeyD", "KeyW", "KeyA", "KeyS"];
for (let i = 0; i < 16; i++) {
  const key = keys[i % keys.length];
  await page.keyboard.down(key);
  await sleep(1400);
  await page.keyboard.up(key);
  await shot(`fight-probe-${String(i).padStart(2, "0")}`);
}
await browser.close();
console.log("done");
