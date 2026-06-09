// Regression guard for the "rotating brings the title screen back" bug (2026-06-09).
//
// Root cause: the WebGL backing buffer is designW·S × 720·S (S = RENDER_SCALE, frozen
// at load). Loading in PORTRAIT (tall winH → large S) then rotating to LANDSCAPE kept
// that big S while designW grew ~5×, producing a >4096-wide canvas. Wider than the GPU
// MAX_TEXTURE_SIZE (4096 on most iOS/mobile GPUs) → WebGL context loss → mobile Safari
// RELOADS the page → boots back to the title. Fix caps S so the buffer's longest side
// stays under 4096 in EITHER orientation (src/compat/kaboomShim.js).
//
// This probe loads at DPR 3 (iPhone-class) in portrait, rotates to landscape and back,
// and FAILS if the backing buffer ever exceeds the texture limit.
import { chromium } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5177";
const LIMIT = 4096; // GPU MAX_TEXTURE_SIZE floor we must stay under
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
p.on("pageerror", (e) => console.log("PAGEERR:", e.message));

let worst = 0;
const probe = async (label) => {
  const s = await p.evaluate(() => {
    const cv = document.querySelector("canvas");
    return { win: innerWidth + "x" + innerHeight, w: cv ? cv.width : 0, h: cv ? cv.height : 0 };
  });
  const longest = Math.max(s.w, s.h);
  worst = Math.max(worst, longest);
  console.log(label.padEnd(16), `win ${s.win}  buffer ${s.w}x${s.h}  (${(s.w * s.h / 1e6).toFixed(1)} Mpx)`);
  return s;
};

await p.goto(URL, { waitUntil: "networkidle" });
await p.waitForSelector("canvas", { timeout: 15000 });
await sleep(8000);
await probe("load portrait");
await p.setViewportSize({ width: 844, height: 390 }); await sleep(1000);
await probe("-> landscape");
await p.setViewportSize({ width: 390, height: 844 }); await sleep(1000);
await probe("-> portrait");
await b.close();

if (worst > LIMIT) { console.log(`FAIL: backing buffer reached ${worst}px (> ${LIMIT} texture limit)`); process.exit(1); }
console.log(`PASS: backing buffer peaked at ${worst}px (<= ${LIMIT})`);
