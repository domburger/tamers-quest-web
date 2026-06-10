// Reach the world and inject a fake rival into net.state.players (tight loop to beat the 15Hz
// snapshot) to audit how OTHER players render: avatar, name tag, and the "Rivals in view" line.
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
if (!ready) { await shot("rv-notinworld"); await browser.close(); process.exit(0); }
await page.keyboard.down("KeyD"); await sleep(300); await page.keyboard.up("KeyD"); await sleep(400);
// Replace net.state.players with a GETTER that always returns rivals near the player, so the
// render always sees them regardless of the snapshot's writes (which we swallow in the setter).
await page.evaluate(() => {
  const s = globalThis.__net.state;
  Object.defineProperty(s, "players", {
    configurable: true,
    get() {
      if (!s.self) return [];
      return [
        { id: "r1", x: s.self.x + 130, y: s.self.y - 40, name: "Ravager", dir: { x: -1, y: 0 } },
        { id: "r2", x: s.self.x - 110, y: s.self.y + 90, name: "A_Very_Long_Rival_Name", dir: { x: 1, y: 0 } },
      ];
    },
    set() { /* swallow snapshot writes */ },
  });
});
await sleep(700);
await shot("rv-rivals");
await browser.close();
console.log("done");
