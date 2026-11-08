// Screenshot the out-of-lobby scenes that carry a top-left Back button (settings / profile / friends / account).
import { chromium } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/tour";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true }); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on("pageerror", (e) => console.log("PAGEERR:", e.message.split("\n")[0]));
await p.goto(URL + "/", { waitUntil: "networkidle" }); await sleep(2500);
await p.click("#guestBtn"); await sleep(600); await p.fill("#guest-nick", "Scout"); await p.click("#guest-go"); await sleep(2500);
for (const s of ["settings", "profile", "friends", "account"]) {
  await p.evaluate((n) => window.tqGo(n), s); await sleep(1500);
  await p.screenshot({ path: `${OUT}/d-back-${s}.png`, ...(process.env.FULL ? {} : { clip: { x: 0, y: 0, width: 640, height: 120 } }) }); console.log("shot", s);
}
await b.close();
