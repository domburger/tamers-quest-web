// Inject rivals carrying the 4 DISTINCT character body-models (knight/mage/automaton/
// wisp) via charId, using the getter-override trick to beat the 15Hz snapshot, to verify
// the new networked body-model path renders each rival as a different figure in-world.
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
if (!ready) { await shot("rm-notinworld"); await browser.close(); process.exit(0); }
await page.keyboard.down("KeyD"); await sleep(300); await page.keyboard.up("KeyD"); await sleep(400);
await page.evaluate(() => {
  const s = globalThis.__net.state;
  // The 5 NEW models (characterCosmetics): warden/seraph/diver/monarch/corvid — verify each
  // renders on a NETWORKED RIVAL (rivals use the red threat-accent, not the cosmetic accent).
  const defs = [
    { id: "k", dx: 120, dy: -70, name: "Wild_Warden_Rival0", charId: "warden" },
    { id: "m", dx: -120, dy: -70, name: "Dawn_Seraph_Rival0", charId: "seraph" },
    { id: "a", dx: 120, dy: 80, name: "Abyssal_Diver_Rivl", charId: "diver" },
    { id: "w", dx: -120, dy: 80, name: "Gilded_Monarch_Rvl", charId: "monarch" },
    { id: "x", dx: 200, dy: 0, name: "Plague_Corvid_Rivl", charId: "corvid" },
  ];
  Object.defineProperty(s, "players", { configurable: true,
    get() { if (!s.self) return []; return defs.map((d) => ({ id: d.id, x: s.self.x + d.dx, y: s.self.y + d.dy, name: d.name, charId: d.charId, dir: { x: 0, y: 1 }, moving: false })); },
    set() {} });
});
await sleep(700);
await shot("rm-rivalmodels");
await browser.close();
console.log("done");
