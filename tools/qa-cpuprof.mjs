// CPU-profile a popup open (CDP Profiler) and print the hottest functions by self time.
import { chromium } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const STATION = process.env.STATION || "battlepass";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await p.goto(URL + "/", { waitUntil: "networkidle" });
await p.waitForSelector("canvas", { timeout: 20000 }); await sleep(3000);
await p.click("#guestBtn").catch(() => {}); await sleep(800); await p.fill("#guest-nick", "Scout").catch(() => {}); await p.click("#guest-go").catch(() => {}); await sleep(2500);
await p.mouse.click(640, 645); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
// warm once (first-open effects aside), then profile the second open
await p.evaluate((s) => window.__openStation(s), STATION); await sleep(1500); await p.evaluate(() => window.__closeStation()); await sleep(500);
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
await b.close();
