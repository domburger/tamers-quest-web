import { chromium, devices } from "playwright";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true });
for (const [n, o] of [["d", { viewport: { width: 1280, height: 720 } }], ["m", { ...devices["iPhone 13"], deviceScaleFactor: 1 }]]) {
  const ctx = await b.newContext(o); const p = await ctx.newPage();
  await p.goto("http://localhost:5173/", { waitUntil: "networkidle" }); await sleep(2000);
  if (n === "m") await p.tap("#guestBtn"); else await p.click("#guestBtn"); await sleep(700);
  await p.screenshot({ path: `C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/tour/${n}-01-guest-modal.png` }); console.log("shot", n);
  await ctx.close();
}
await b.close();
