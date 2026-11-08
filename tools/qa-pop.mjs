import { chromium, devices } from "playwright";
const URL = "http://localhost:5173";
const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/tour";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LANDSCAPE = process.env.LANDSCAPE === "1";
const MOBILE = process.env.MOBILE === "1" || LANDSCAPE;
const b = await chromium.launch({ headless: true });
const ctx = LANDSCAPE ? await b.newContext({ ...devices["iPhone 13 landscape"], deviceScaleFactor: 1 }) : MOBILE ? await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 1 }) : await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERR:", e.message.split("\n")[0]));
p.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 200)); });
await p.goto(URL + "/", { waitUntil: "networkidle" }); await sleep(2500);
if (MOBILE) await p.tap("#guestBtn"); else await p.click("#guestBtn"); await sleep(600);
await p.fill("#guest-nick", "Scout"); if (MOBILE) await p.tap("#guest-go"); else await p.click("#guest-go"); await sleep(2500);
const vp = p.viewportSize();
if (MOBILE) await p.touchscreen.tap(vp.width / 2, vp.height - (LANDSCAPE ? 40 : 70)); else await p.mouse.click(vp.width / 2, vp.height - 80); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
if (process.env.SHOT_HUB) { await p.screenshot({ path: `${OUT}/${LANDSCAPE ? "l" : MOBILE ? "m" : "d"}-04-hub.png` }); console.log("shot hub"); }
const ids = (process.env.IDS || "portal,market,profile,battlepass").split(",").filter(Boolean);
for (const id of ids) {
  // PRE: optional JS run before opening (e.g. PRE='__net.state.bpXp=400;__net.state.bpClaimed=["free:1"]') to stage a state.
  if (process.env.PRE) await p.evaluate((code) => { try { (0, eval)(code); } catch (e) { console.log("PRE failed", e.message); } }, process.env.PRE);
  await p.evaluate((sid) => window.__openStation && window.__openStation(sid), id); await sleep(1500);
  if (process.env.SCROLL) { const got = await p.evaluate((y) => window.__stationScroll && window.__stationScroll(y), Number(process.env.SCROLL)); console.log("scrolled to", got); await sleep(500); } // SCROLL=px (DEV hook; clamped to the sheet's max)
  await p.screenshot({ path: `${OUT}/${LANDSCAPE ? "l" : MOBILE ? "m" : "d"}-10-popup-${id}.png` }); console.log("shot", id);
  await p.evaluate(() => window.__closeStation && window.__closeStation()); await sleep(400);
}
await b.close();
