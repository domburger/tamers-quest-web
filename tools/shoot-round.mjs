// Visual QA for the *online in-round* view — the one thing shoot.mjs (menus) and
// shoot-sp.mjs (single-player) don't capture. Drives a headless browser through
// start → online lobby → connect → queue → into a live round, then screenshots
// the map view (floor tiles, players, HUD, spirit-chain projectiles) and logs any
// in-round client error.
//
// Run against a DEDICATED combined server so you don't disturb other instances or
// the shared dist target (the client hardcodes ws://localhost:8080 for http, so a
// custom port needs the URL baked at build time):
//
//   VITE_SERVER_URL=ws://localhost:8099 npm run build
//   PORT=8099 MATCH_MIN_PLAYERS=1 MATCH_COUNTDOWN_S=0 node server/index.js &   # instant solo round
//   GAME_URL=http://localhost:8099 node tools/shoot-round.mjs
//
// Output: .screenshots/05-online-round.png  (.screenshots is gitignored)

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.GAME_URL || "http://localhost:8080";
const NICK = process.env.NICK || "shotbot";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLEERR:", m.text()); });

// Load + let fonts and procedural sprites generate.
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(4500);

// Title → "Play Online" (primary button, centered at y≈0.70).
await page.mouse.click(640, Math.round(720 * 0.70));
await sleep(1200);

// Lobby: nickname is a real DOM <input>; "Connect & Queue" is a canvas button at y≈0.56.
await page.fill("input", NICK).catch(() => {});
await sleep(300);
await page.mouse.click(640, Math.round(720 * 0.56));

// Wait out the match countdown + client-side map generation, then capture.
console.log("waiting for round formation + map generation…");
await sleep(16000);
await page.screenshot({ path: `${OUT}/05-online-round.png` });
console.log("shot: 05-online-round (idle)");

// Capture a frame mid-movement — the camera is then at a sub-pixel offset, which
// is when any tile overlap (oversized tiles) or gaps (undersized) become visible.
await page.keyboard.down("d");
await sleep(500);
await page.screenshot({ path: `${OUT}/06-online-moving.png` });
await page.keyboard.up("d");
console.log("shot: 06-online-moving");

await browser.close();
console.log("done");
