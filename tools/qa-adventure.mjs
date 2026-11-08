// TQ-529 Adventure mode: enter via the portal popup's 3rd button, confirm no timer/storm, walk to a map edge
// to travel (depth 2), then ESC → Return to village and check the result card + team kept.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:5173";
const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/shots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
p.on("pageerror", (e) => console.log("PAGEERR:", e.message));
const shot = async (n) => { await p.screenshot({ path: `${OUT}/adv-${n}.png` }); console.log("shot: adv-" + n); };
const st = () => p.evaluate(() => { const s = globalThis.__net?.state; return { adv: s?.adventure, depth: s?.depth, seed: s?.seed, x: Math.round(s?.self?.x || 0), y: Math.round(s?.self?.y || 0), combat: !!s?.combat, rr: s?.roundResult || null, team: (s?.team || []).length, circle: !!s?.circle, time: s?.time }; });
await p.goto(URL + "/", { waitUntil: "networkidle" }); await p.waitForSelector("canvas", { timeout: 20000 }); await sleep(3000);
await p.click("#guestBtn").catch(() => {}); await sleep(800); await p.fill("#guest-nick", "Scout").catch(() => {}); await p.click("#guest-go").catch(() => {}); await sleep(2500);
await p.mouse.click(640, 640); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
await p.evaluate(() => localStorage.setItem("tq_onboarded", "1")); // skip the overlay; tutorial off (key present → step 99)
await p.evaluate(() => localStorage.setItem("tq_tutorial", "99"));
await p.evaluate(() => window.__openStation("portal")); await sleep(1200); await shot("0-picker");
await p.mouse.click(640, 208 + 168); await sleep(9000); // Adventure button (sp +56, mp +140, adv +224 → 168 below sp centre)
console.log("entered:", JSON.stringify(await st())); await shot("1-world");
// walk toward the nearest edge
let s0 = await st(); const E = 80, maxXY = 399 * E;
const dxToEdge = s0.x < maxXY - s0.x ? "KeyA" : "KeyD", dyToEdge = s0.y < maxXY - s0.y ? "KeyW" : "KeyS";
const distX = Math.min(s0.x, maxXY - s0.x), distY = Math.min(s0.y, maxXY - s0.y);
const key = distX < distY ? dxToEdge : dyToEdge; const alt = distX < distY ? dyToEdge : dxToEdge;
console.log(`walking ${key} (dist ${Math.min(distX, distY)}px)`);
let travelled = false;
for (let i = 0; i < 400 && !travelled; i++) {
  await p.keyboard.down(key); await sleep(700); await p.keyboard.up(key);
  const s = await st();
  if (s.combat) { // fight: attack until over, dismiss
    for (let t = 0; t < 12; t++) { await p.keyboard.press("Digit1"); await sleep(2200); const c = await st(); if (!c.combat) break; const o = await p.evaluate(() => globalThis.__net?.state?.combat?.outcome); if (o) { await sleep(600); await p.keyboard.press("Space"); await sleep(1200); break; } }
  }
  if (s.depth >= 2) { travelled = true; console.log("travelled:", JSON.stringify(s)); }
  if (i % 20 === 19) { console.log(`  ${i}: ${JSON.stringify(s)}`); if (Math.abs(s.x - s0.x) + Math.abs(s.y - s0.y) < 60) { await p.keyboard.down(alt); await sleep(900); await p.keyboard.up(alt); } s0 = s; }
}
await sleep(4000); await shot("2-region2");
await p.keyboard.press("Escape"); await sleep(600); await shot("3-pause");
await p.mouse.click(640, 360 - 64 + 72 * 2 + 28); await sleep(2500); // "Return to village"
console.log("after return:", JSON.stringify(await st())); await shot("4-result");
await b.close();
