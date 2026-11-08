// Title screen + guest modal + empty character select, desktop and phone.
import { chromium, devices } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/tour";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true });
for (const M of [false, true]) {
  const ctx = M ? await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 1 }) : await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage(); const tag = M ? "m" : "d";
  p.on("pageerror", (e) => console.log("PAGEERR:", e.message.split("\n")[0]));
  const hit = (sel) => M ? p.tap(sel) : p.click(sel);
  await p.goto(URL + "/", { waitUntil: "networkidle" }); await sleep(2500);
  await p.screenshot({ path: `${OUT}/${tag}-00-title.png` });
  await hit("#guestBtn"); await sleep(700); await p.screenshot({ path: `${OUT}/${tag}-01-guest.png` });
  await p.fill("#guest-nick", "Scout"); await hit("#guest-go"); await sleep(2500);
  await p.screenshot({ path: `${OUT}/${tag}-02-charselect-empty.png` });
  console.log("shots", tag);
  await ctx.close();
}
await b.close();
