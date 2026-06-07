// Capture the procedural monster generator's silhouettes via the standalone
// harness (tools/bestiary-preview.html) — no game-UI navigation, so it can't
// break when lobby/menu layouts move. Verifies the brutal animal-archetype gen
// (P5-T5 / PT1-T21): a lineup of distinct silhouettes that read as predators.
// Usage: GAME_URL=http://localhost:5173 node tools/shoot-bestiary.mjs [mode]
//   mode = lineup (default) | random
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.GAME_URL || "http://localhost:5173";
const MODE = process.argv[2] || "lineup";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 820, height: 600 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLEERR:", m.text()); });

await page.goto(`${URL}/tools/bestiary-preview.html?mode=${MODE}`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__ready === true, { timeout: 15000 }).catch(() => {});
await sleep(800);
const path = `${OUT}/bestiary-${MODE}.png`;
await page.screenshot({ path, fullPage: true });
console.log("shot:", path);

await browser.close();
console.log("done");
