// Measure the worst frame around opening a station sheet, twice (2nd open = warm raster caches → isolates the frost capture).
import { chromium, devices } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = process.env.MOBILE === "1" ? await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 2 }) : await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
await p.goto(URL + "/", { waitUntil: "networkidle" }); await sleep(2500);
const M = process.env.MOBILE === "1"; const hit = (sel) => M ? p.tap(sel) : p.click(sel);
await hit("#guestBtn"); await sleep(600); await p.fill("#guest-nick", "Scout"); await hit("#guest-go"); await sleep(2500);
const vp = p.viewportSize(); if (M) await p.touchscreen.tap(vp.width / 2, vp.height - 70); else await p.mouse.click(vp.width / 2, vp.height - 75); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
for (const id of (process.env.IDS || "shop,vault").split(",")) for (let n = 0; n < 2; n++) {
  const r = await p.evaluate(async (sid) => {
    const d = []; let last = performance.now(); let raf;
    const tick = () => { const t = performance.now(); d.push(t - last); last = t; raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick);
    const t0 = performance.now(); window.__openStation(sid); const tOpen = performance.now() - t0;
    await new Promise((res) => setTimeout(res, 1500)); cancelAnimationFrame(raf);
    d.sort((a, b) => a - b); return { tOpen: +tOpen.toFixed(1), max: +d[d.length - 1].toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), n: d.length };
  }, id);
  console.log(id, n === 0 ? "cold" : "warm", JSON.stringify(r));
  await p.evaluate(() => window.__closeStation()); await sleep(600);
}
await b.close();
