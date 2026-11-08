// Frame-time probe: open a station popup on a phone viewport and measure rAF deltas (ms) for ~3s.
import { chromium, devices } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = process.env.MOBILE === "1" ? await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 2 }) : await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
await p.goto(URL + "/", { waitUntil: "networkidle" });
await p.waitForSelector("canvas", { timeout: 20000 }); await sleep(3000);
await p.click("#guestBtn").catch(() => {}); await sleep(800); await p.fill("#guest-nick", "Scout").catch(() => {}); await p.click("#guest-go").catch(() => {}); await sleep(2500);
const vp = p.viewportSize(); await p.mouse.click(vp.width / 2, vp.height - 75); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
const measure = () => p.evaluate(() => new Promise((res) => { const d = []; let last = performance.now(); const tick = (t) => { d.push(t - last); last = t; if (d.length < 120) requestAnimationFrame(tick); else res(d); }; requestAnimationFrame(tick); }));
const stats = (d) => { d.sort((a, b) => a - b); return `avg ${(d.reduce((s, x) => s + x, 0) / d.length).toFixed(1)}ms  p50 ${d[d.length >> 1].toFixed(1)}  p95 ${d[Math.floor(d.length * 0.95)].toFixed(1)}  max ${d[d.length - 1].toFixed(1)}`; };
console.log("hub:", stats(await measure()));
for (const id of (process.env.STATIONS || "battlepass,shop,vault,bestiary,settings").split(",")) {
  await p.evaluate((s) => window.__openStation && window.__openStation(s), id); await sleep(1200);
  console.log(id + ":", stats(await measure()));
  await p.evaluate(() => window.__closeStation && window.__closeStation()); await sleep(400);
}
await b.close();
