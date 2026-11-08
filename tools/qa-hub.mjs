// QA: lobby endless-floor (TQ-561) + vault popup inspect (TQ-562) against the dev client.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:5173";
const OUT = process.env.OUT || "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/shots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
p.on("pageerror", (e) => console.log("PAGEERR:", e.message));
p.on("console", (m) => { const t = m.text(); if (/error|undefined|NaN|cannot/i.test(t) && !/favicon|DevTools/i.test(t)) console.log("CONSOLE:", t.slice(0, 200)); });
const shot = async (n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); console.log("shot:", n); };
await p.goto(URL + "/", { waitUntil: "networkidle" });
await p.waitForSelector("canvas", { timeout: 20000 }); await sleep(3000);
await p.click("#guestBtn").catch(() => {}); await sleep(800);
await p.fill("#guest-nick", "Scout").catch(() => {});
await p.click("#guest-go").catch(() => {}); await sleep(2500);
await p.mouse.click(640, 640); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => p.mouse.click(640, 360).then(() => p.keyboard.type("Scout")));
await p.keyboard.press("Enter"); await sleep(3000);
console.log("popup:", await p.evaluate(() => (window.__stationPopupId ? window.__stationPopupId() : "no-hub-hooks")));
await shot("hub-0-spawn");
// walk far north of the camp so the old abyss band would be in view
const pos = await p.evaluate(() => window.__hubPos && window.__hubPos());
console.log("pos:", pos);
if (pos) { await p.evaluate(([x, y]) => window.__hubTele(x, y - 520), [pos.x, pos.y]); await sleep(800); await shot("hub-1-north"); }
if (pos) { await p.evaluate(([x, y]) => window.__hubTele(x - 700, y + 300), [pos.x, pos.y]); await sleep(800); await shot("hub-2-southwest"); }
if (process.env.TELE) { const [tx, ty] = process.env.TELE.split(",").map(Number); await p.evaluate(([x, y]) => window.__hubTele(x, y), [tx, ty]); await sleep(900); await shot("hub-3-tele"); }
if (pos) { await p.evaluate(([x, y]) => window.__hubTele(x, y), [pos.x, pos.y]); await sleep(400); }
for (const [i, pt] of (process.env.PRE || "").split(";").filter(Boolean).entries()) {
  const [x, y] = pt.split(",").map(Number);
  await p.mouse.move(x, y); await p.mouse.down(); await sleep(60); await p.mouse.up(); await sleep(900);
  await shot(`pre-click-${i}-${x}x${y}`);
  await p.keyboard.press("Escape"); await sleep(400);
}
// station popups: STATIONS="vault:424,245|500,245;bestiary:400,300" → open each, click the listed points, screenshot after each
const specs = (process.env.STATIONS || "vault").split(";").filter(Boolean);
for (const spec of specs) {
  const [id, pts = ""] = spec.split(":");
  await p.evaluate(() => window.__closeStation && window.__closeStation());
  await p.evaluate((sid) => window.__openStation && window.__openStation(sid), id); await sleep(1500);
  console.log(`popup(${id}):`, await p.evaluate(() => window.__stationPopupId && window.__stationPopupId()));
  await shot(`${id}-0-open`);
  for (const [i, pt] of pts.split("|").filter(Boolean).entries()) {
    const [x, y] = pt.split(",").map(Number);
    await p.mouse.move(x, y); await p.mouse.down(); await sleep(60); await p.mouse.up(); await sleep(900);
    console.log(`  after click ${x},${y} popup:`, await p.evaluate(() => window.__stationPopupId && window.__stationPopupId()));
    await shot(`${id}-click-${i}-${x}x${y}`);
  }
  // close via the X button of the popup shell (top-right) using Escape twice is unreliable → reload-free close hook if present
  await p.keyboard.press("Escape"); await sleep(400);
  if (await p.evaluate(() => window.__stationPopupId && window.__stationPopupId())) { await p.keyboard.press("Escape"); await sleep(400); }
}
await b.close();
console.log("done");
