// Capture the live non-monster procedural art (player + menu/combat backgrounds)
// via the standalone harness tools/art-gallery.html — layout-proof, no game-UI
// nav (which is unreliable during a multi-agent swarm). Counterpart to
// tools/shoot-bestiary.mjs (monsters).
// Usage: GAME_URL=http://localhost:5173 node tools/shoot-art.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.GAME_URL || "http://localhost:5173";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 760 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLEERR:", m.text()); });

await page.goto(`${URL}/tools/art-gallery.html`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__ready === true, { timeout: 15000 }).catch(() => {});
await sleep(700);
const path = `${OUT}/art-gallery.png`;
await page.screenshot({ path, fullPage: true });
console.log("shot:", path);

await browser.close();
console.log("done");
