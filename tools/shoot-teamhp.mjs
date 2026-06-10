// Inject varied team HP (full / warn / danger / fainted) into net.state.self.team via getter
// override, to audit the in-world TEAM HUD bar colors + the fainted (0 HP) rendering — a path
// only ever seen at full HP.
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
if (!ready) { await shot("thp-notinworld"); await browser.close(); process.exit(0); }
await page.keyboard.down("KeyD"); await sleep(300); await page.keyboard.up("KeyD"); await sleep(400);
await page.evaluate(() => {
  // The snapshot replaces the whole self object each tick, so a getter override on the nested
  // self.team is lost — instead re-mutate hp/max in a tight interval to beat the 15Hz snapshot.
  const fracs = [1.0, 0.4, 0.12, 0.0]; // full / warn / danger / fainted
  globalThis.__thp = setInterval(() => {
    const t = globalThis.__net?.state?.self?.team;
    if (t) t.forEach((m, i) => { const mx = m.max || m.hp || 100; m.max = mx; m.hp = Math.round(mx * (fracs[i] ?? 1)); });
  }, 20);
});
await sleep(700);
await shot("thp-teamhud");
await browser.close();
console.log("done");
