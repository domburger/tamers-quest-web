// TQ-518 first-run tutorial walkthrough: fresh guest → onboarding → step 1 (move) → step 2 (fight) → step 3
// (finish) → step 4 (extract). Screenshots the objective pill at each step. Needs ENCOUNTER_RADIUS=600 server.
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:5173";
const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/shots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOBILE = process.env.MOBILE === "1";
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = MOBILE ? await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 1 }) : await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const p = await ctx.newPage(); const PFX = MOBILE ? "tm-" : "td-";
p.on("pageerror", (e) => console.log("PAGEERR:", e.message));
const shot = async (n) => { await p.screenshot({ path: `${OUT}/${PFX}${n}.png` }); console.log("shot:", PFX + n); };
const tut = () => p.evaluate(() => ({ step: localStorage.getItem("tq_tutorial"), combat: !!globalThis.__net?.state?.combat, outcome: globalThis.__net?.state?.combat?.outcome || null }));
await p.goto(URL + "/", { waitUntil: "networkidle" }); await p.waitForSelector("canvas", { timeout: 20000 }); await sleep(3000);
await p.click("#guestBtn").catch(() => {}); await sleep(800); await p.fill("#guest-nick", "Scout").catch(() => {}); await p.click("#guest-go").catch(() => {}); await sleep(2500);
const vp = p.viewportSize(); await p.mouse.click(vp.width / 2, vp.height - (MOBILE ? 70 : 80)); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
await p.evaluate(() => window.__openStation && window.__openStation("portal")); await sleep(1200);
if (MOBILE) await p.touchscreen.tap(vp.width / 2, 140); else await p.mouse.click(640, 208);
await sleep(8000);
await p.keyboard.press("KeyD"); await sleep(400); // dismiss onboarding (a tiny nudge; not enough to complete "move")
console.log("after onboarding:", JSON.stringify(await tut())); await shot("1-step-move");
await p.keyboard.down("KeyD"); await sleep(1200); await p.keyboard.up("KeyD"); await sleep(400);
console.log("after moving:", JSON.stringify(await tut())); await shot("2-step-fight");
for (let i = 0; i < 30 && !(await tut()).combat; i++) { const key = ["KeyS", "KeyA", "KeyW", "KeyD"][Math.floor(i / 4) % 4]; await p.keyboard.down(key); await sleep(600); await p.keyboard.up(key); await sleep(300); }
await sleep(1500); console.log("in combat:", JSON.stringify(await tut())); await shot("3-step-finish");
for (let turn = 0; turn < 10 && !(await tut()).outcome; turn++) { await p.keyboard.press("Digit1"); await sleep(2500); }
await sleep(800); console.log("after fight:", JSON.stringify(await tut())); await shot("4-step-extract-card");
await p.keyboard.press("Space"); await sleep(1500); await shot("5-step-extract");
await b.close();
