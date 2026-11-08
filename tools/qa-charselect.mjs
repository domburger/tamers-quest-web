// Character select WITH a character (the tour only sees the empty state): guest → create → hub → back to select.
import { chromium, devices } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/tour";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const M = process.env.MOBILE === "1";
const b = await chromium.launch({ headless: true });
const ctx = M ? await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 1 }) : await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERR:", e.message.split("\n")[0]));
const hit = (sel) => M ? p.tap(sel) : p.click(sel);
await p.goto(URL + "/", { waitUntil: "networkidle" }); await sleep(2500);
await hit("#guestBtn"); await sleep(600); await p.fill("#guest-nick", "Scout"); await hit("#guest-go"); await sleep(2500);
const vp = p.viewportSize(); if (M) await p.touchscreen.tap(vp.width / 2, vp.height - 70); else await p.mouse.click(vp.width / 2, vp.height - 80); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
await p.evaluate(() => window.tqGo("characterSelect")); await sleep(1800);
await p.screenshot({ path: `${OUT}/${M ? "m" : "d"}-02b-charselect-filled.png` }); console.log("shot charselect");
if (!M) { await p.mouse.move(640, 300); await sleep(400); await p.screenshot({ path: `${OUT}/d-02c-charselect-hover.png` }); }
await b.close();
