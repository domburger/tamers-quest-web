// Settings popup on a touch-primary phone: the keyboard Controls section must be hidden.
import { chromium, devices } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 1 }); const p = await ctx.newPage();
await p.goto(URL + "/", { waitUntil: "networkidle" }); await p.waitForSelector("canvas", { timeout: 20000 }); await sleep(3000);
await p.tap("#guestBtn").catch(() => {}); await sleep(800); await p.fill("#guest-nick", "Scout").catch(() => {}); await p.tap("#guest-go").catch(() => {}); await sleep(2500);
const vp = p.viewportSize(); await p.touchscreen.tap(vp.width / 2, vp.height - 70); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
await p.evaluate(() => window.__openStation("settings")); await sleep(1500);
await p.screenshot({ path: `${OUT}/settings-touch.png` }); console.log("shot: settings-touch");
await b.close();
