// Monster detail modal from the Bestiary sheet (tap the first card) + the hub account dropdown, desktop or MOBILE=1.
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
const tap = (x, y) => M ? p.touchscreen.tap(x, y) : p.mouse.click(x, y);
await p.goto(URL + "/", { waitUntil: "networkidle" }); await sleep(2500);
await hit("#guestBtn"); await sleep(600); await p.fill("#guest-nick", "Scout"); await hit("#guest-go"); await sleep(2500);
const vp = p.viewportSize(); await tap(vp.width / 2, vp.height - (M ? 70 : 80)); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
await p.evaluate(() => window.__openStation("bestiary")); await sleep(1500);
// first card centre: design → page via __designToPage

const d2p = async (x, y) => p.evaluate(([x, y]) => (window.__designToPage ? window.__designToPage(x, y) : { x, y }), [x, y]);
const c = await d2p(M ? 95 : 312, M ? 130 : 210);
await tap(c.x, c.y); await sleep(1200);
await p.screenshot({ path: `${OUT}/${M ? "m" : "d"}-12-detail.png` }); console.log("shot detail");
await p.keyboard.press("Escape"); await sleep(400); await p.keyboard.press("Escape"); await sleep(400);
const av = await p.evaluate(() => window.__avatarBadge && window.__avatarBadge());
if (av) { const q = await d2p(av.x, av.y); await tap(q.x, q.y); await sleep(800); await p.screenshot({ path: `${OUT}/${M ? "m" : "d"}-11-account-menu.png` }); console.log("shot account"); }
else console.log("no __avatarBadge hook");
await b.close();
