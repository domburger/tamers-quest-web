// Round-END regression: enter a solo run on a server started with ROUND_DURATION_S=45 and wait for the
// result card (timeout → "Run Over"); screenshot it. Desktop or MOBILE=1.
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:5173";
const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/shots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOBILE = process.env.MOBILE === "1";
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = MOBILE ? await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 1 }) : await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const p = await ctx.newPage(); const PFX = MOBILE ? "rem-" : "red-";
p.on("pageerror", (e) => console.log("PAGEERR:", e.message));
await p.goto(URL + "/", { waitUntil: "networkidle" }); await p.waitForSelector("canvas", { timeout: 20000 }); await sleep(3000);
await p.click("#guestBtn").catch(() => {}); await sleep(800); await p.fill("#guest-nick", "Scout").catch(() => {}); await p.click("#guest-go").catch(() => {}); await sleep(2500);
const vp = p.viewportSize(); await p.mouse.click(vp.width / 2, vp.height - (MOBILE ? 70 : 80)); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
await p.evaluate(() => window.__openStation && window.__openStation("portal")); await sleep(1200);
if (MOBILE) await p.touchscreen.tap(vp.width / 2, 140); else await p.mouse.click(640, 208);
await sleep(8000); await p.keyboard.press("KeyD"); await sleep(500);
let rr = null;
for (let i = 0; i < 100 && !rr; i++) { await sleep(1000); rr = await p.evaluate(() => globalThis.__net?.state?.roundResult || null); if (i % 10 === 0) { const t = await p.evaluate(() => globalThis.__net?.state?.time); console.log(`  t+${i}s time-left ${t}`); } }
console.log("roundResult:", JSON.stringify(rr));
await sleep(900); await p.screenshot({ path: `${OUT}/${PFX}result.png` }); console.log("shot:", PFX + "result");
await b.close();
