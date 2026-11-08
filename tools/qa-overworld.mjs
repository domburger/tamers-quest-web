// Overworld HUD capture under ENCOUNTER_RADIUS=600: enter a run, flee the instant a fight starts (flee cooldown +
// post-fight grace give a quiet window), then screenshot the overworld HUD. Desktop or MOBILE=1.
import { chromium, devices } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const L = process.env.LANDSCAPE === "1"; const M = process.env.MOBILE === "1" || L;
const b = await chromium.launch({ headless: true });
const ctx = L ? await b.newContext({ ...devices["iPhone 13 landscape"], deviceScaleFactor: 1 }) : M ? await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 1 }) : await b.newContext({ viewport: { width: 1280, height: 720 } });
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERR:", e.message.split("\n")[0]));
const hit = (s) => M ? p.tap(s) : p.click(s); const tap = (x, y) => M ? p.touchscreen.tap(x, y) : p.mouse.click(x, y);
const st = () => p.evaluate(() => { const s = globalThis.__net?.state; return { combat: !!s?.combat, out: s?.combat?.outcome || null, self: !!s?.self }; });
await p.goto(URL + "/", { waitUntil: "networkidle" }); await sleep(2500);
await hit("#guestBtn"); await sleep(600); await p.fill("#guest-nick", "Scout"); await hit("#guest-go"); await sleep(2500);
const vp = p.viewportSize(); await tap(vp.width / 2, vp.height - (L ? 40 : M ? 70 : 80)); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
await p.evaluate(() => { try { localStorage.setItem("tq_onboarded", "1"); localStorage.setItem("tq_tutorial", "99"); } catch {} window.__openStation("portal"); }); await sleep(900);
const btn = await p.evaluate(() => window.__portalButtons());
const pt = await p.evaluate(([x, y]) => (window.__designToPage ? window.__designToPage(x, y) : { x, y }), [btn[0].x, btn[0].y]);
await tap(pt.x, pt.y); await sleep(8000);
await p.keyboard.press("KeyD"); await sleep(600); // dismiss onboarding
for (let i = 0; i < 20; i++) { const s = await st(); if (s.combat && !s.out) { await p.keyboard.press("KeyF"); await sleep(1500); const s2 = await st(); if (s2.out) { await p.keyboard.press("Space"); await sleep(600); break; } } else if (s.self && !s.combat) break; await sleep(400); }
await sleep(400);
// PRE: optional JS to stage HUD state before the shot, e.g. PRE='__net.state.atRisk={catches:2,items:1}'.
if (process.env.PRE) { await p.evaluate((code) => { try { (0, eval)(code); } catch (e) { console.log("PRE failed", e.message); } }, process.env.PRE); await sleep(400); }
await p.screenshot({ path: `${OUT}/${L ? "l" : M ? "m" : "d"}-overworld.png` }); console.log("shot overworld", JSON.stringify(await st()));
await b.close();
