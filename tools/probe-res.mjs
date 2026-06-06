import { chromium } from "playwright";
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
async function probe(w, h, dsf) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dsf });
  await p.goto(process.env.GAME_URL || "http://localhost:8080/", { waitUntil: "networkidle" });
  await new Promise((r) => setTimeout(r, 4000));
  const info = await p.evaluate(() => {
    const c = document.querySelector("canvas");
    return c ? {
      dpr: window.devicePixelRatio, win: [window.innerWidth, window.innerHeight],
      backing: [c.width, c.height], css: [c.clientWidth, c.clientHeight],
      style: [c.style.width, c.style.height],
    } : { error: "no canvas" };
  });
  console.log(`viewport ${w}x${h} dsf=${dsf}:`, JSON.stringify(info));
  await p.close();
}
await probe(2560, 1440, 1); // 4K-ish window at 100% OS scaling (DPR 1)
await probe(1280, 720, 2);  // what my screenshots use (DPR 2)
await probe(1920, 1080, 1); // 1080p at 100%
await b.close();
