// Stuck probe: walk D 2.5s, then hold A for 3s and log server position every 200ms + the tiles around the body.
import { chromium } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true }); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto(URL + "/", { waitUntil: "networkidle" }); await sleep(2500);
await p.click("#guestBtn"); await sleep(600); await p.fill("#guest-nick", "Scout"); await p.click("#guest-go"); await sleep(2500);
await p.mouse.click(640, 640); await sleep(1200); await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
await p.evaluate(() => { try { localStorage.setItem("tq_onboarded", "1"); localStorage.setItem("tq_tutorial", "99"); } catch {} window.__openStation("portal"); }); await sleep(900);
const btn = await p.evaluate(() => window.__portalButtons()); await p.mouse.click(btn[0].x, btn[0].y); await sleep(8000);
const sample = () => p.evaluate(() => { const r = window.__selfRender(); const s = globalThis.__net.state; return { x: Math.round(r.x), y: Math.round(r.y), sx: Math.round(r.sx), sy: Math.round(r.sy), combat: !!s.combat }; });
const seq = async (keys, ms, label) => { for (const k of keys) await p.keyboard.down(k); const rows = []; const t0 = Date.now(); while (Date.now() - t0 < ms) { rows.push(await sample()); await sleep(200); } for (const k of keys) await p.keyboard.up(k); console.log(label, rows.map((r) => `${r.x},${r.y}${r.combat ? "C" : ""}`).join(" ")); };
await seq(["KeyD"], 2500, "D ");
await seq(["KeyA", "KeyS"], 2000, "AS");
await seq(["KeyA"], 3000, "A ");
await seq(["KeyS"], 3000, "S ");
await seq(["KeyW"], 2000, "W ");
await seq(["KeyD"], 2000, "D2");
await b.close();
