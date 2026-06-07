// Close-up of the bestiary's first rows so monster faces can be inspected in
// detail (slit pupils, fangs, brows, scars) — the P5-T5 "brutal, not cute"
// direction. Grid-scale shots are too small to judge the fine face signals.
// Usage: GAME_URL=http://localhost:5176 node tools/shoot-faces.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.GAME_URL || "http://localhost:8080";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
// DSF=2 for crisp detail; clip keeps the output PNG under the 2000px read limit.
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLEERR:", m.text()); });

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(4500); // fonts + procedural sprite generation
await page.keyboard.press("b");
await sleep(2500);

// Default: first two rows of monster cards (≈ y 40–470), spanning the grid width.
// Override with CLIP="x,y,w,h" to zoom one card so fine signals (fangs, slit
// pupils, scars) are large enough to read once the viewer downscales the PNG.
const clip = process.env.CLIP
  ? (([x, y, width, height]) => ({ x, y, width, height }))(process.env.CLIP.split(",").map(Number))
  : { x: 150, y: 40, width: 880, height: 420 };
await page.screenshot({ path: `${OUT}/faces-1.png`, clip });
console.log("shot: faces-1", JSON.stringify(clip));

await browser.close();
console.log("done");
