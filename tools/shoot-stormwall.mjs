// Reach the world and walk toward the safe-zone circle center (read via __net) to bring the
// storm wall / safe-zone edge on-screen and examine its rendering.
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
const st = () => page.evaluate(() => { try { const s = globalThis.__net?.state; if (!s?.self) return null; return { self: { x: s.self.x, y: s.self.y }, circle: s.circle ? { x: s.circle.x, y: s.circle.y, r: s.circle.r } : null, seed: s.seed }; } catch { return null; } });
const s0 = await st();
console.log("circle:", s0?.circle ? `c=${Math.round(s0.circle.x)},${Math.round(s0.circle.y)} r=${Math.round(s0.circle.r)}` : "none", "self:", s0?.self ? `${Math.round(s0.self.x)},${Math.round(s0.self.y)}` : "none");
if (!s0?.self || s0.seed == null) { await shot("sw-notinworld"); await browser.close(); process.exit(0); }
await page.keyboard.down("KeyD"); await sleep(300); await page.keyboard.up("KeyD"); await sleep(400);
// Inject a SMALL circle near the player so the storm-wall edge is on-screen (the real circle
// only shrinks this far ~5min in). Re-inject in a tight loop to beat the 15Hz snapshot overwrite.
if (process.env.INJECT === "1") {
  for (let k = 0; k < 8; k++) {
    await page.evaluate(() => { const s = globalThis.__net.state; if (s.self) s.circle = { x: s.self.x - 120, y: s.self.y - 60, r: 280 }; });
    await sleep(60);
  }
  await shot("sw-injected-wall");
  await browser.close(); process.exit(0);
}
// Walk toward the circle center (or just sweep) until near the edge, capturing.
let prev = null, stuck = 0;
for (let i = 0; i < 40; i++) {
  const s = await st(); if (!s?.self) break;
  const c = s.circle || { x: s.self.x + 1000, y: s.self.y };
  const dx = c.x - s.self.x, dy = c.y - s.self.y;
  const dist = Math.hypot(dx, dy);
  if (i % 5 === 0) { console.log(`i${i}: self=${Math.round(s.self.x)},${Math.round(s.self.y)} dist-to-center=${Math.round(dist)} r=${s.circle ? Math.round(s.circle.r) : "?"}`); await shot(`sw-${i}`); }
  if (s.circle && dist < s.circle.r * 0.9) break; // well inside — edge captured on the way
  const ks = [];
  if (dx > 10) ks.push("KeyD"); else if (dx < -10) ks.push("KeyA");
  if (dy > 10) ks.push("KeyS"); else if (dy < -10) ks.push("KeyW");
  if (prev && Math.hypot(s.self.x - prev.x, s.self.y - prev.y) < 8) { stuck++; if (stuck >= 2) { const p = Math.abs(dx) > Math.abs(dy) ? "KeyS" : "KeyD"; await page.keyboard.down(p); await sleep(500); await page.keyboard.up(p); prev = s.self; continue; } } else stuck = 0;
  prev = s.self;
  for (const k of ks) await page.keyboard.down(k);
  await sleep(300);
  for (const k of ks) await page.keyboard.up(k);
}
await shot("sw-final");
await browser.close();
console.log("done");
