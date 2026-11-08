// Diagnostic: enter a fight, press attack 1 repeatedly, print enemy/active HP + log length per turn.
import { chromium } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true }); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on("pageerror", (e) => console.log("PAGEERR:", e.message.split("\n")[0]));
const st = () => p.evaluate(() => { const c = globalThis.__net?.state?.combat; return c ? { out: c.outcome || null, log: c.log?.length || 0, ehp: c.enemy?.currentHealth, emax: c.enemy?.maxHealth, ahp: c.active?.currentHealth, wait: !!c.waiting, turn: c.turn } : null; });
await p.goto(URL + "/", { waitUntil: "networkidle" }); await sleep(2500);
await p.click("#guestBtn"); await sleep(600); await p.fill("#guest-nick", "Scout"); await p.click("#guest-go"); await sleep(2500);
await p.mouse.click(640, 640); await sleep(1200); await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
await p.evaluate(() => window.__openStation("portal")); await sleep(1000);
const btn = await p.evaluate(() => window.__portalButtons()); await p.mouse.click(btn[0].x, btn[0].y); await sleep(8000);
await p.keyboard.press("KeyD"); await sleep(800);
for (let i = 0; i < 40 && !(await st()); i++) { const key = ["KeyD", "KeyS", "KeyA", "KeyW"][Math.floor(i / 5) % 4]; await p.keyboard.down(key); await sleep(600); await p.keyboard.up(key); await sleep(300); }
console.log("start", JSON.stringify(await st()));
await sleep(1500);
for (let t = 0; t < 14; t++) {
  const before = await st(); if (!before || before.out) break;
  await p.keyboard.press("Digit1");
  let s = before; for (let w = 0; w < 40; w++) { await sleep(300); s = await st(); if (!s || s.out || s.log > before.log) break; }
  console.log(`turn ${t}:`, JSON.stringify(s));
  if (s && s.out) { const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/shots"; await sleep(150); await p.screenshot({ path: `${OUT}/fight-summary-a.png` }); await sleep(700); await p.screenshot({ path: `${OUT}/fight-summary-b.png` }); console.log("shots"); break; }
}
await b.close();
