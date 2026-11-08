// Popup OPEN stall: time from __openStation(id) until two animation frames have painted, per popup.
import { chromium, devices } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = process.env.MOBILE === "1" ? await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 2 }) : await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERR:", e.message));
await p.goto(URL + "/", { waitUntil: "networkidle" });
await p.waitForSelector("canvas", { timeout: 20000 }); await sleep(3000);
await p.click("#guestBtn").catch(() => {}); await sleep(800); await p.fill("#guest-nick", "Scout").catch(() => {}); await p.click("#guest-go").catch(() => {}); await sleep(2500);
const vp = p.viewportSize(); await p.mouse.click(vp.width / 2, vp.height - 75); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
const rows = [];
for (const id of (process.env.STATIONS || "vault,shop,battlepass,bestiary,settings,cosmetics,market,profile").split(",")) {
  for (let rep = 0; rep < 2; rep++) {
    const ms = await p.evaluate((sid) => new Promise((res) => { const t0 = performance.now(); window.__openStation(sid); requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now() - t0))); }), id);
    rows.push({ popup: id, open: rep === 0 ? "first" : "again", ms: +ms.toFixed(0) });
    await sleep(600);
    await p.evaluate(() => window.__closeStation && window.__closeStation()); await sleep(300);
  }
}
console.table(rows);
await b.close();
