// Title page at phone + desktop sizes (footer/stage overlap check).
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:5173";
const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/shots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true });
for (const [name, ctxOpts] of [["phone", { ...devices["iPhone 13"], deviceScaleFactor: 1 }], ["short", { viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 }], ["desktop", { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 }]]) {
  const ctx = await b.newContext(ctxOpts); const p = await ctx.newPage();
  await p.goto(URL + "/", { waitUntil: "networkidle" }); await sleep(2500);
  await p.screenshot({ path: `${OUT}/title-${name}.png` }); console.log("shot: title-" + name);
  await ctx.close();
}
await b.close();
