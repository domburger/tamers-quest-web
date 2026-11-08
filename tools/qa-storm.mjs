// Storm overlays: run against a server started with CIRCLE_START_S=5 ROUND_DURATION_S=70 ENCOUNTER_RADIUS=0; enter a run,
// wait for the circle, walk one direction until outside the zone, screenshot the danger card + vignette; then the
// final-minute clock chip. Desktop or MOBILE=1.
import { chromium, devices } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const M = process.env.MOBILE === "1";
const b = await chromium.launch({ headless: true });
const ctx = M ? await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 1 }) : await b.newContext({ viewport: { width: 1280, height: 720 } });
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERR:", e.message.split("\n")[0]));
const hit = (s) => M ? p.tap(s) : p.click(s); const tap = (x, y) => M ? p.touchscreen.tap(x, y) : p.mouse.click(x, y);
const st = () => p.evaluate(() => { const s = globalThis.__net?.state; const c = s?.circle, me = s?.self; return { time: s?.time, circle: !!c, outside: !!(c && me && ((me.x - c.x) ** 2 + (me.y - c.y) ** 2) > c.r * c.r), danger: me?.danger || 0, combat: !!s?.combat }; });
await p.goto(URL + "/", { waitUntil: "networkidle" }); await sleep(2500);
await hit("#guestBtn"); await sleep(600); await p.fill("#guest-nick", "Scout"); await hit("#guest-go"); await sleep(2500);
const vp = p.viewportSize(); await tap(vp.width / 2, vp.height - (M ? 70 : 80)); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
await p.evaluate(() => { try { localStorage.setItem("tq_onboarded", "1"); localStorage.setItem("tq_tutorial", "99"); } catch {} window.__openStation("portal"); }); await sleep(900);
const btn = await p.evaluate(() => window.__portalButtons());
const pt = await p.evaluate(([x, y]) => (window.__designToPage ? window.__designToPage(x, y) : { x, y }), [btn[0].x, btn[0].y]);
await tap(pt.x, pt.y); await sleep(8000);
for (let i = 0; i < 20 && !(await st()).circle; i++) await sleep(500);
console.log("circle", JSON.stringify(await st()));
// stand still: the zone shrinks to nothing over the short round, so the spawn ends up outside it
for (let i = 0; i < 120; i++) { await sleep(500); const s = await st(); if (s.outside) break; }
await sleep(1500);
console.log("outside", JSON.stringify(await st()));
await p.screenshot({ path: `${OUT}/${M ? "m" : "d"}-storm.png` }); console.log("shot storm");
// wait for the final minute
for (let i = 0; i < 40; i++) { const s = await st(); if (s.time && s.time <= 58) break; await sleep(1000); }
await sleep(300); await p.screenshot({ path: `${OUT}/${M ? "m" : "d"}-finalminute.png` }); console.log("shot finalminute", JSON.stringify(await st()));
await b.close();
