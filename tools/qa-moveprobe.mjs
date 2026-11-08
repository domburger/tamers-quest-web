// Movement probe: hold D 2.5s, sample render vs server position every 50ms; report speed, backward jumps,
// render/server error, and coasting after release. Then a short W tap. Desktop; needs DEV __selfRender hook.
import { chromium } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true }); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on("pageerror", (e) => console.log("PAGEERR:", e.message.split("\n")[0]));
await p.goto(URL + "/", { waitUntil: "networkidle" }); await sleep(2500);
await p.click("#guestBtn"); await sleep(600); await p.fill("#guest-nick", "Scout"); await p.click("#guest-go"); await sleep(2500);
await p.mouse.click(640, 640); await sleep(1200); await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
await p.evaluate(() => { try { localStorage.setItem("tq_onboarded", "1"); localStorage.setItem("tq_tutorial", "99"); } catch {} window.__openStation("portal"); }); await sleep(900);
const btn = await p.evaluate(() => window.__portalButtons()); await p.mouse.click(btn[0].x, btn[0].y); await sleep(8000);
const sample = () => p.evaluate(() => { const r = window.__selfRender && window.__selfRender(); const s = globalThis.__net?.state; return r ? { ...r, combat: !!s?.combat, t: performance.now() } : null; });
const run = async (key, holdMs, label) => {
  const out = [];
  await p.keyboard.down(key);
  const t0 = Date.now();
  while (Date.now() - t0 < holdMs) { const s = await sample(); if (s) out.push(s); await sleep(50); }
  await p.keyboard.up(key);
  const after = []; for (let i = 0; i < 16; i++) { await sleep(50); const s = await sample(); if (s) after.push(s); }
  let back = 0, maxErr = 0, speeds = [];
  for (let i = 1; i < out.length; i++) { const a = out[i - 1], c = out[i]; const dxr = c.x - a.x; const dt = (c.t - a.t) / 1000; if (dt > 0) speeds.push(Math.hypot(c.x - a.x, c.y - a.y) / dt); if (key === "KeyD" && dxr < -1) back++; if (key === "KeyW" && (c.y - a.y) > 1) back++; maxErr = Math.max(maxErr, Math.hypot(c.x - c.sx, c.y - c.sy)); }
  speeds.sort((a, b) => a - b);
  const coast = after.length > 2 ? Math.hypot(after[after.length - 1].x - after[1].x, after[after.length - 1].y - after[1].y) : 0;
  const srvCoast = after.length > 2 ? Math.hypot(after[after.length - 1].sx - after[1].sx, after[after.length - 1].sy - after[1].sy) : 0;
  console.log(label, JSON.stringify({ samples: out.length, combat: out.some((s) => s.combat), speedMed: Math.round(speeds[speeds.length >> 1] || 0), speedMin: Math.round(speeds[0] || 0), speedMax: Math.round(speeds[speeds.length - 1] || 0), backJumps: back, maxRenderServerErr: Math.round(maxErr), renderCoastAfterRelease: Math.round(coast), serverCoastAfterRelease: Math.round(srvCoast), rtt: out[0]?.rtt }));
};
await run("KeyD", 2500, "hold-D");
await sleep(600);
await run("KeyW", 300, "tap-W");
await sleep(400);
await p.keyboard.down("KeyA"); await p.keyboard.down("KeyS"); await sleep(1500); const d1 = await sample(); await sleep(500); const d2 = await sample(); await p.keyboard.up("KeyA"); await p.keyboard.up("KeyS");
await run("KeyA", 3000, "hold-A-3s"); await run("KeyS", 3000, "hold-S-3s");
console.log("diag speed", Math.round(Math.hypot(d2.x - d1.x, d2.y - d1.y) / ((d2.t - d1.t) / 1000)), "server-render err", Math.round(Math.hypot(d2.x - d2.sx, d2.y - d2.sy)));
await b.close();
