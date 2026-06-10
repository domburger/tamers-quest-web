// Inject a POPULATED vault (net.state.vault getter override) and resize to restart the roster
// scene so it re-reads the vault, to audit the vault grid (caught monsters) at desktop + narrow —
// a real-data state never seen (vault is always empty 0/100 for a fresh guest).
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
await page.fill("#guest-nick", "Scout"); await page.click("#guest-go"); await sleep(2500);
await page.mouse.click(640, 720 - 80); await sleep(1200);
await page.fill('input[placeholder="Character name"]', "Scout"); await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2500);
await page.mouse.click(640, 130); await sleep(2500);
await page.mouse.click(230, 225); await sleep(2200); // Inventory
await page.evaluate(() => {
  const names = ["Gale Finch","Boulderback Tortoise","Brimstone Gargoyle","Aqua Drifter","Glimmer Sprite","Shadow Wyrm","Frostfire Salamander","Voidwalker Scorpion","Bramble Golem","Crystal Golem"];
  const vault = names.map((n, i) => ({ id: "v" + i, typeName: n, name: n, level: (i % 9) + 1, currentHealth: 100 + i * 7, xp: 0 }));
  Object.defineProperty(globalThis.__net.state, "vault", { configurable: true, get() { return vault; }, set() {} });
});
await page.setViewportSize({ width: 1282, height: 720 }); await sleep(1400); // restart roster → re-reads vault
await shot("vault-desktop");
await page.setViewportSize({ width: 390, height: 844 }); await sleep(1400);
await shot("vault-narrow");
await browser.close();
console.log("done");
