// Dump the open fight's client state (attacks with cost/damage/affordable inputs, active energy, waiting flags)
// a few seconds after combat starts — to explain greyed-out attack buttons. Needs ENCOUNTER_RADIUS=600 on the server.
import { chromium } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true }); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on("pageerror", (e) => console.log("PAGEERR:", e.message.split("\n")[0]));
await p.goto(URL + "/", { waitUntil: "networkidle" }); await sleep(2500);
await p.click("#guestBtn"); await sleep(600); await p.fill("#guest-nick", "Scout"); await p.click("#guest-go"); await sleep(2500);
await p.mouse.click(640, 640); await sleep(1200); await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
await p.evaluate(() => { localStorage.setItem("tq_onboarded", "1"); localStorage.setItem("tq_tutorial", "99"); window.__openStation("portal"); }); await sleep(900);
const btn = await p.evaluate(() => window.__portalButtons()); await p.mouse.click(btn[0].x, btn[0].y);
for (let i = 0; i < 40; i++) { await sleep(500); if (await p.evaluate(() => !!globalThis.__net?.state?.combat)) break; }
await sleep(3000);
console.log(JSON.stringify(await p.evaluate(() => { const c = globalThis.__net.state.combat; return { attacks: c.attacks, activeEnergy: c.active?.currentEnergy, activeMaxEnergy: c.active?.maxEnergy ?? c.active?.energy, activeKeys: Object.keys(c.active || {}), waiting: c.waiting, outcome: c.outcome }; }), null, 1));
await b.close();
