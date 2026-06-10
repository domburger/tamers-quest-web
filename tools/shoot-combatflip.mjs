// Reach combat, then sample net.state + screenshot every 600ms for ~6s to see whether
// (and why) the combat screen flips away — log combat/roundResult/onTitle/connected each tick.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8080";
mkdirSync(".screenshots", { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
const shot = async (n) => { await page.screenshot({ path: `.screenshots/${n}.png` }); };
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(8000);
await page.click("#guestBtn"); await sleep(600);
await page.fill("#guest-nick", "Scout"); await page.click("#guest-go"); await sleep(2200);
await page.mouse.click(640, 720 - 80); await sleep(1200);
await page.fill('input[placeholder="Character name"]', "Scout"); await sleep(300);
await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2200);
await page.mouse.click(640, 130); await sleep(2500);
await page.mouse.click(230, 150); await sleep(900);
await page.mouse.click(640, 300); await sleep(6000);
await page.keyboard.down("KeyD"); await sleep(300); await page.keyboard.up("KeyD"); await sleep(400);
const snap = () => page.evaluate(() => {
  const s = globalThis.__net?.state || {};
  return { combat: !!s.combat, outcome: s.combat?.outcome || null, rr: s.roundResult ? (s.roundResult.reason || "yes") : null,
    connected: !!s.connected, self: !!s.self, onTitle: !document.getElementById("title")?.classList.contains("hidden") };
});
// roam to find a monster
let inC = false;
for (let step = 0; step < 80 && !inC; step++) {
  const st = await page.evaluate(() => { const s = globalThis.__net?.state; if (!s?.self) return null; return { inC: !!s.combat, mons: (s.monsters||[]).map(m=>({x:m.x,y:m.y})), x: s.self.x, y: s.self.y }; });
  if (!st) break;
  if (st.inC) { inC = true; break; }
  if (!st.mons.length) { const k = ["KeyD","KeyS","KeyA","KeyW"][Math.floor(step/3)%4]; await page.keyboard.down(k); await sleep(700); await page.keyboard.up(k); continue; }
  let best = st.mons[0], bd = Infinity; for (const m of st.mons) { const d=(m.x-st.x)**2+(m.y-st.y)**2; if(d<bd){bd=d;best=m;} }
  const ks = []; if (best.x-st.x>12) ks.push("KeyD"); else if (best.x-st.x<-12) ks.push("KeyA"); if (best.y-st.y>12) ks.push("KeyS"); else if (best.y-st.y<-12) ks.push("KeyW");
  if (!ks.length) ks.push("KeyD"); for (const k of ks) await page.keyboard.down(k); await sleep(260); for (const k of ks) await page.keyboard.up(k);
}
console.log("reached combat:", inC);
if (!inC) { await browser.close(); process.exit(0); }
for (let t = 0; t < 11; t++) {
  const s = await snap();
  console.log(`t=${(t*0.6).toFixed(1)}s`, JSON.stringify(s));
  await shot(`cf-${String(t).padStart(2,"0")}`);
  await sleep(600);
}
await browser.close();
console.log("done");
