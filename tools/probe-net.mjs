import { chromium } from "playwright";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
for (const url of ["http://localhost:8080", "http://localhost:5190"]) {
  const p = await b.newPage();
  try { await p.goto(url, { waitUntil: "domcontentloaded", timeout: 8000 }); await sleep(3500);
    const has = await p.evaluate(() => typeof globalThis.__net);
    console.log(url, "__net:", has);
  } catch (e) { console.log(url, "ERR", e.message.slice(0,60)); }
  await p.close();
}
await b.close();
