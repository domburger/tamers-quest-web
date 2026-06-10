// Use the getter-override trick to inject a small safe-zone circle (storm wall near the
// player) and an extraction portal, beating the 15Hz snapshot, to audit those core visuals.
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
await page.mouse.click(230, 190); await sleep(900);
await page.mouse.click(640, 300); await sleep(6000);
const ready = await page.evaluate(() => !!(globalThis.__net?.state?.self && globalThis.__net.state.seed != null));
console.log("in world:", ready);
if (!ready) { await shot("sp-notinworld"); await browser.close(); process.exit(0); }
await page.keyboard.down("KeyD"); await sleep(300); await page.keyboard.up("KeyD"); await sleep(400);
const OUTSIDE = process.env.OUTSIDE === "1";
await page.evaluate((outside) => {
  const s = globalThis.__net.state;
  // INSIDE: player just inside the wall. OUTSIDE: player in the storm, wall to the right.
  const cfg = outside ? { dx: 360, r: 200 } : { dx: -220, r: 300 };
  Object.defineProperty(s, "circle", { configurable: true,
    get() { return s.self ? { x: s.self.x + cfg.dx, y: s.self.y, r: cfg.r } : null; }, set() {} });
  Object.defineProperty(s, "portals", { configurable: true,
    get() { return s.self ? [{ x: s.self.x + 170, y: s.self.y - 120 }] : []; }, set() {} });
}, OUTSIDE);
await sleep(1200); // let ambient storm particles emit when outside the zone
await shot(OUTSIDE ? "sp-outside-storm" : "sp-stormwall-portal");
await browser.close();
console.log("done");
