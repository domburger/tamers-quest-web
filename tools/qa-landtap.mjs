// Landscape-phone tap probe: open the run picker and tap the Singleplayer card; report the hook's coordinates
// and whether the run starts (net phase) after a touchscreen tap and after a mouse click.
import { chromium, devices } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ ...devices["iPhone 13 landscape"], deviceScaleFactor: 1 }); const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERR:", e.message.split("\n")[0]));
await p.goto(URL + "/", { waitUntil: "networkidle" }); await sleep(2500);
await p.tap("#guestBtn"); await sleep(600); await p.fill("#guest-nick", "Scout"); await p.tap("#guest-go"); await sleep(2500);
const vp = p.viewportSize(); await p.touchscreen.tap(vp.width / 2, vp.height - 40); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
await p.evaluate(() => { localStorage.setItem("tq_onboarded", "1"); localStorage.setItem("tq_tutorial", "99"); window.__openStation("portal"); }); await sleep(1200);
const info = await p.evaluate(() => { const b0 = window.__portalButtons()[0]; return { design: b0, page: window.__designToPage ? window.__designToPage(b0.x, b0.y) : null, k: [window.__tqK?.width(), window.__tqK?.height()], vp: [innerWidth, innerHeight], station: window.__stationPopupId?.() }; });
console.log("hook", JSON.stringify(info));
const sc = info.vp[0] / info.k[0], pt = info.page || { x: info.design.x * sc, y: info.design.y * sc }; await p.touchscreen.tap(pt.x, pt.y); await sleep(2500);
console.log("after tap: station", await p.evaluate(() => window.__stationPopupId?.()), "phase", await p.evaluate(() => globalThis.__net?.state?.phase));
await b.close();
