// CPU-profile a popup open (CDP Profiler) and print the hottest functions by self time.
import { chromium, devices } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const STATION = process.env.STATION || "battlepass";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const M = process.env.MOBILE === "1";
const ctx0 = M ? await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 2 }) : await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const p = await ctx0.newPage();
await p.goto(URL + "/", { waitUntil: "networkidle" });
await p.waitForSelector("canvas", { timeout: 20000 }); await sleep(3000);
const hit = (sel) => M ? p.tap(sel) : p.click(sel);
await hit("#guestBtn").catch(() => {}); await sleep(800); await p.fill("#guest-nick", "Scout").catch(() => {}); await hit("#guest-go").catch(() => {}); await sleep(2500);
const vp = p.viewportSize(); if (M) await p.touchscreen.tap(vp.width / 2, vp.height - 70); else await p.mouse.click(640, 645); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
// warm once (first-open effects aside), then profile the second open
if (process.env.COLD !== "1") { await p.evaluate((s) => window.__openStation(s), STATION); await sleep(1500); await p.evaluate(() => window.__closeStation()); await sleep(500); }
const cdp = await p.context().newCDPSession(p);
await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
await cdp.send("Profiler.start");
const ms = await p.evaluate((sid) => new Promise((res) => { const t0 = performance.now(); window.__openStation(sid); requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now() - t0))); }), STATION);
const { profile } = await cdp.send("Profiler.stop");
console.log(`${STATION} open → 2 frames: ${ms.toFixed(0)} ms; samples ${profile.samples.length}`);
// aggregate self time per node
const self = new Map(); const dt = profile.timeDeltas;
for (let i = 0; i < profile.samples.length; i++) { const id = profile.samples[i]; self.set(id, (self.get(id) || 0) + (dt[i] || 0)); }
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const rows = [...self.entries()].map(([id, us]) => { const n = byId.get(id); const cf = n.callFrame; return { fn: cf.functionName || "(anon)", file: (cf.url || "").split("/").slice(-1)[0] + ":" + cf.lineNumber, ms: +(us / 1000).toFixed(1) }; }).sort((a, b) => b.ms - a.ms).slice(0, 14);
console.table(rows);
// parent chain of the hottest node (self time) — where is it being called from?
const parentOf = new Map(); for (const n of profile.nodes) for (const c of (n.children || [])) parentOf.set(c, n.id);
let hot = [...self.entries()].sort((a, b) => b[1] - a[1])[0][0];
const chain = []; for (let i = 0; i < 12 && hot != null; i++) { const n = byId.get(hot); chain.push(`${n.callFrame.functionName || "(anon)"}@${(n.callFrame.url || "").split("/").slice(-1)[0].split("?")[0]}:${n.callFrame.lineNumber + 1}`); hot = parentOf.get(hot); }
console.log("hot parent chain:", chain.join("  <-  "));
await b.close();
