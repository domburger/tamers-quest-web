// Hub: teleport beside the merchant so the interaction prompt pill shows; screenshot the rail + prompt.
import { chromium } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true }); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on("pageerror", (e) => console.log("PAGEERR:", e.message.split("\n")[0]));
await p.goto(URL + "/", { waitUntil: "networkidle" }); await sleep(2500);
await p.click("#guestBtn"); await sleep(600); await p.fill("#guest-nick", "Scout"); await p.click("#guest-go"); await sleep(2500);
await p.mouse.click(640, 640); await sleep(1200); await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
const r = await p.evaluate(async () => { const { GAME } = await import("/src/engine/schemas.js"); const E = GAME.EFFECTIVE_TILE; window.__hubTele(20.2 * E, 8.6 * E + 175); return E; });
console.log("E", r); await sleep(900);
await p.screenshot({ path: `${OUT}/hub-prompt.png` }); console.log("shot hub-prompt");
await b.close();
