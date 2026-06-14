// TQ-252 — frame-time benchmark for the engine-removal spike (TQ-227/228): the raw-canvas2D backend
// (?backend=canvas, the TQ-251 lobby) vs the live Phaser backend (the real hub scene), at desktop
// (1x CPU) and a mid-mobile proxy (4x CPU throttle via CDP Emulation.setCPUThrottlingRate).
//
// Both backends are measured the SAME way for fairness: sample requestAnimationFrame deltas in-page
// over a fixed window, then report avg / p95 frame-time (ms) + fps. Run against a local prod server:
//   node server/index.js &   then   node tools/canvasbench.mjs
//
// CAVEAT (documented with the result): headless Chromium uses software GL (swiftshader), which
// under-represents real-GPU Phaser/WebGL and is only a directional signal; a real mid-range device
// is the authoritative check (tracked as a Human Task).
import { chromium } from "playwright";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = process.env.BASE || "http://localhost:8080";
const SAMPLE_MS = 3500;

const sampler = (ms) => new Promise((resolve) => {
  const deltas = []; let last = performance.now(); const t0 = last;
  const tick = (now) => { deltas.push(now - last); last = now; if (now - t0 < ms) requestAnimationFrame(tick); else resolve(deltas); };
  requestAnimationFrame(tick);
});

function stats(deltas) {
  const d = deltas.slice(2).filter((x) => x > 0 && x < 1000).sort((a, b) => a - b); // drop warmup + outliers
  if (!d.length) return { avg: 0, p95: 0, fps: 0, n: 0 };
  const avg = d.reduce((a, b) => a + b, 0) / d.length;
  const p95 = d[Math.min(d.length - 1, Math.floor(d.length * 0.95))];
  return { avg: +avg.toFixed(2), p95: +p95.toFixed(2), fps: Math.round(1000 / avg), n: d.length };
}

const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

async function bench(label, url, cpu, prep) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  let err = null; p.on("pageerror", (e) => { err = e.message; });
  const cdp = await p.context().newCDPSession(p);
  if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  await p.goto(url, { waitUntil: "networkidle" });
  await sleep(2500);
  if (prep) { try { await prep(p); } catch { /* best effort */ } }
  await sleep(1500);
  const deltas = await p.evaluate(sampler, SAMPLE_MS);
  await p.close();
  const s = stats(deltas);
  return { label, cpu, err, ...s };
}

const rows = [];
rows.push(await bench("phaser hub", BASE + "/", 1, async (p) => { await p.evaluate(() => window.tqGuest && window.tqGuest("Bench")); await sleep(800); await p.evaluate(() => window.tqGo && window.tqGo("hub", { characterId: 0 })); }));
rows.push(await bench("canvas lobby", BASE + "/?backend=canvas", 1, null));
rows.push(await bench("phaser hub", BASE + "/", 4, async (p) => { await p.evaluate(() => window.tqGuest && window.tqGuest("Bench")); await sleep(800); await p.evaluate(() => window.tqGo && window.tqGo("hub", { characterId: 0 })); }));
rows.push(await bench("canvas lobby", BASE + "/?backend=canvas", 4, null));

await b.close();
console.log("\nbackend        CPU   avg ms   p95 ms   fps   frames   error");
console.log("-".repeat(64));
for (const r of rows) {
  console.log(`${r.label.padEnd(13)} ${(r.cpu + "x").padStart(3)}   ${String(r.avg).padStart(6)}   ${String(r.p95).padStart(6)}   ${String(r.fps).padStart(3)}   ${String(r.n).padStart(6)}   ${r.err ? "ERR " + r.err : "ok"}`);
}
console.log("\n(headless swiftshader — directional only; real-device confirm tracked separately)\n");
