// Touch movement probe (phone profile): drag the virtual joystick for 2.5 s, sample positions every 100 ms; then release
// and check the player stops. Uses the DEV __selfRender hook.
import { chromium, devices } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 1 }); const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERR:", e.message.split("\n")[0]));
await p.goto(URL + "/", { waitUntil: "networkidle" }); await sleep(2500);
await p.tap("#guestBtn"); await sleep(600); await p.fill("#guest-nick", "Scout"); await p.tap("#guest-go"); await sleep(2500);
const vp = p.viewportSize(); await p.touchscreen.tap(vp.width / 2, vp.height - 70); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
await p.evaluate(() => { try { localStorage.setItem("tq_onboarded", "1"); localStorage.setItem("tq_tutorial", "99"); } catch {} window.__openStation("portal"); }); await sleep(900);
const btn = await p.evaluate(() => window.__portalButtons());
const pt = await p.evaluate(([x, y]) => (window.__designToPage ? window.__designToPage(x, y) : { x, y }), [btn[0].x, btn[0].y]);
await p.touchscreen.tap(pt.x, pt.y); await sleep(8000);
const sample = () => p.evaluate(() => { const r = window.__selfRender(); const s = globalThis.__net.state; return { x: Math.round(r.x), y: Math.round(r.y), sx: Math.round(r.sx), sy: Math.round(r.sy), combat: !!s.combat }; });
// Drag on the left half: a CDP touch sequence (touchscreen API has no drag), start at (90, H-150), move right 70px, hold.
const cdp = await ctx.newCDPSession(p);
const sx0 = 90, sy0 = vp.height - 150;
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: sx0, y: sy0, id: 1 }] });
for (let i = 1; i <= 7; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: sx0 + i * 10, y: sy0, id: 1 }] }); await sleep(30); }
const rows = []; const t0 = Date.now();
while (Date.now() - t0 < 2500) { rows.push(await sample()); await sleep(100); }
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
const after = []; for (let i = 0; i < 8; i++) { await sleep(100); after.push(await sample()); }
const dxs = rows.slice(1).map((r, i) => r.x - rows[i].x);
console.log("drag-right xs:", rows.map((r) => r.x + (r.combat ? "C" : "")).join(" "));
console.log("per-100ms dx:", dxs.join(" "), "| after release dx:", after[after.length - 1].x - after[0].x, "| max render-server err:", Math.max(...rows.map((r) => Math.hypot(r.x - r.sx, r.y - r.sy))).toFixed(0));
await b.close();
