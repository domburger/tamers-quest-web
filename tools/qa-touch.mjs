// Touch QA: phone viewport, tap a Vault team card, then a Bestiary card (TQ-562 repro on touch).
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:5173";
const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/shots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERR:", e.message));
const shot = async (n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); console.log("shot:", n); };
await p.goto(URL + "/", { waitUntil: "networkidle" });
await p.waitForSelector("canvas", { timeout: 20000 }); await sleep(3000);
await p.tap("#guestBtn").catch(() => {}); await sleep(800);
await p.fill("#guest-nick", "Scout").catch(() => {});
await p.tap("#guest-go").catch(() => {}); await sleep(2500);
await shot("m-0-after-guest");
// character create: tap the create button area then type
const vp = p.viewportSize();
await p.touchscreen.tap(vp.width / 2, vp.height - 70); await sleep(1200);
await shot("m-1-charcreate");
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {});
await p.keyboard.press("Enter"); await sleep(3000);
await shot("m-2-hub");
await p.evaluate(() => window.__openStation && window.__openStation("vault")); await sleep(1500);
console.log("popup:", await p.evaluate(() => window.__stationPopupId && window.__stationPopupId()));
await shot("m-3-vault");
const taps = (process.env.TAPS || "").split(";").filter(Boolean).map((s) => s.split(",").map(Number));
for (const [i, [x, y]] of taps.entries()) { await p.touchscreen.tap(x, y); await sleep(1000); console.log(`tap ${x},${y} popup:`, await p.evaluate(() => window.__stationPopupId && window.__stationPopupId())); await shot(`m-4-vault-tap-${i}`); }
await b.close(); console.log("done");
