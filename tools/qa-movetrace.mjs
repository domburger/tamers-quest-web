// Movement TRACE: hold one key for HOLD ms and log every 50ms sample (render x/y, server x/y, step size), to see
// exactly when stalls / snaps happen under simulated lag (server env SIM_LAG_MS / SIM_JITTER_MS). DEV hooks.
import { chromium } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const KEY = process.env.KEY || "KeyD", HOLD = Number(process.env.HOLD || 3000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true }); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on("pageerror", (e) => console.log("PAGEERR:", e.message.split("\n")[0]));
await p.goto(URL + "/", { waitUntil: "networkidle" }); await sleep(2500);
await p.click("#guestBtn"); await sleep(600); await p.fill("#guest-nick", "Scout"); await p.click("#guest-go"); await sleep(2500);
await p.mouse.click(640, 640); await sleep(1200); await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
await p.evaluate(() => { try { localStorage.setItem("tq_onboarded", "1"); localStorage.setItem("tq_tutorial", "99"); } catch {} window.__openStation("portal"); }); await sleep(900);
const btn = await p.evaluate(() => window.__portalButtons()); await p.mouse.click(btn[0].x, btn[0].y); await sleep(8000);
// Sample inside the page on every animation frame (no Playwright round-trip jitter in the timing).
await p.evaluate(() => { window.__trace = []; const t0 = performance.now(); const f = () => { const r = window.__selfRender(); window.__trace.push([Math.round(performance.now() - t0), Math.round(r.x), Math.round(r.sx), r.wall ? 1 : 0, Math.round(r.y), Math.round(r.sy)]); if (window.__trace.length < 4000) requestAnimationFrame(f); }; requestAnimationFrame(f); });
// Hold each key in turn; mark the held windows (page-clock ms) so stalls are only counted while a key is down.
const windows = [];
for (const key of (process.env.KEYS || "KeyD,KeyS,KeyA,KeyW").split(",")) {
  await sleep(300);
  const keys = key.split("+");
  const a = await p.evaluate(() => performance.now()); for (const kk of keys) await p.keyboard.down(kk); await sleep(HOLD); for (const kk of keys) await p.keyboard.up(kk);
  const b2 = await p.evaluate(() => performance.now()); windows.push([key, a, b2]);
}
await sleep(800);
const { tr, t0abs } = await p.evaluate(() => ({ tr: window.__trace, t0abs: 0 }));
const base = await p.evaluate(() => performance.now()) - tr[tr.length - 1][0]; // page-clock of trace t=0 (approx)
void t0abs;
let snaps = 0, stalls = 0, wallFrames = 0, maxGap = 0;
for (const [key, a, b2] of windows) {
  const lo = a - base + 150, hi = b2 - base; // skip the first 150ms (input → first predicted frame)
  const seg = tr.filter((s) => s[0] >= lo && s[0] <= hi);
  let run = 0, segStalls = 0, segSnaps = 0, segWall = 0;
  for (let i = 1; i < seg.length; i++) {
    const dt = seg[i][0] - seg[i - 1][0], d = Math.hypot(seg[i][1] - seg[i - 1][1], seg[i][4] - seg[i - 1][4]);
    if (dt > 0 && d / dt * 1000 > 400) segSnaps++;
    if (seg[i][3]) { segWall++; run = 0; continue; }
    if (d === 0) { run++; if (run === 4) segStalls++; } else run = 0;
    maxGap = Math.max(maxGap, Math.hypot(seg[i][1] - seg[i][2], seg[i][4] - seg[i][5]));
  }
  snaps += segSnaps; stalls += segStalls; wallFrames += segWall;
  console.log(key, "frames", seg.length, "snaps", segSnaps, "stalls(non-wall)", segStalls, "wallFrames", segWall);
}
// Whole-trace jumps (incl. direction changes / releases): any frame step > 400px/s, with its time + size.
const jumps = [];
for (let i = 1; i < tr.length; i++) { const dt = tr[i][0] - tr[i - 1][0], d = Math.hypot(tr[i][1] - tr[i - 1][1], tr[i][4] - tr[i - 1][4]); if (dt > 0 && d / dt * 1000 > 400) jumps.push(`${tr[i][0]}ms:${Math.round(d)}px`); }
console.log("whole-trace jumps", jumps.length, jumps.slice(0, 20).join(" "));
const fin = tr[tr.length - 1];
let hitch = 0; for (let i = 1; i < tr.length; i++) { const dt = tr[i][0] - tr[i - 1][0], d = Math.hypot(tr[i][1] - tr[i - 1][1], tr[i][4] - tr[i - 1][4]); if (dt > 0 && d / dt * 1000 > 300) hitch++; }
console.log("at rest: render-server gap", Math.round(Math.hypot(fin[1] - fin[2], fin[4] - fin[5])), "px | frames faster than 300px/s:", hitch);
console.log("TOTAL snaps", snaps, "stalls", stalls, "wallFrames", wallFrames, "max render-server gap", Math.round(maxGap));
await b.close();
