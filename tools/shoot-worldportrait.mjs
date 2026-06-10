// Reach the world, then switch to a mobile-PORTRAIT viewport to audit the in-round
// HUD in the top/bottom gutter layout (team, timer, minimap, objective-on-square-edge,
// chain, biome, touch controls). Inject a small safe-zone circle so the storm wall +
// objective "outside" state are on-screen too.
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
if (!ready) { await shot("wp-notinworld"); await browser.close(); process.exit(0); }
await page.keyboard.down("KeyD"); await sleep(300); await page.keyboard.up("KeyD"); await sleep(400);
// Switch to portrait phone size.
const pw = Number(process.env.PW) || 390, ph = Number(process.env.PH) || 844;
await page.setViewportSize({ width: pw, height: ph }); await sleep(1500);
await shot(`wp-portrait-${pw}`);
// Now inject the OUTSIDE-zone state to verify the wrapped objective on the square edge.
await page.evaluate(() => {
  const s = globalThis.__net.state;
  Object.defineProperty(s, "circle", { configurable: true,
    get() { return s.self ? { x: s.self.x + 360, y: s.self.y, r: 200 } : null; }, set() {} });
  Object.defineProperty(s, "portals", { configurable: true,
    get() { return s.self ? [{ x: s.self.x + 170, y: s.self.y - 120 }] : []; }, set() {} });
});
await sleep(1200);
await shot(`wp-portrait-outside-${pw}`);
await browser.close();
console.log("done");
