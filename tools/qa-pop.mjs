import { chromium, devices } from "playwright";
const URL = "http://localhost:5173";
const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/tour";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOBILE = process.env.MOBILE === "1";
const b = await chromium.launch({ headless: true });
const ctx = MOBILE ? await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 1 }) : await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERR:", e.message.split("\n")[0]));
p.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 200)); });
await p.goto(URL + "/", { waitUntil: "networkidle" }); await sleep(2500);
if (MOBILE) await p.tap("#guestBtn"); else await p.click("#guestBtn"); await sleep(600);
await p.fill("#guest-nick", "Scout"); if (MOBILE) await p.tap("#guest-go"); else await p.click("#guest-go"); await sleep(2500);
const vp = p.viewportSize();
if (MOBILE) await p.touchscreen.tap(vp.width / 2, vp.height - 70); else await p.mouse.click(vp.width / 2, vp.height - 80); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
const ids = (process.env.IDS || "portal,market,profile,battlepass").split(",");
for (const id of ids) {
  await p.evaluate((sid) => window.__openStation && window.__openStation(sid), id); await sleep(1500);
  await p.screenshot({ path: `${OUT}/${MOBILE ? "m" : "d"}-10-popup-${id}.png` }); console.log("shot", id);
  await p.evaluate(() => window.__closeStation && window.__closeStation()); await sleep(400);
}
await b.close();
