// Visual QA for the *online in-round* view — the one thing shoot.mjs (menus) and
// shoot-sp.mjs (single-player) don't capture. Drives a headless browser through
// start → online lobby → connect → queue → into a live round, then screenshots
// the map view (floor tiles, players, HUD, spirit-chain projectiles) and logs any
// in-round client error.
//
// CLEANEST (no dist rebuild → doesn't disturb the shared dist other loops serve):
// run the Vite DEV server (serves source) + a solo-round WS server on a free port,
// and point the client at it with the ?ws= override (src/net.js reads it):
//
//   npm run dev                                                      # e.g. :5174
//   PORT=8097 MATCH_MIN_PLAYERS=1 MATCH_COUNTDOWN_S=0 node server/index.js
//   GAME_URL="http://localhost:5174/?ws=ws://localhost:8097" node tools/shoot-round.mjs
//
// (Validated 2026-06-07 — confirms the live MP overworld renders.) Alternatively,
// against a DEDICATED combined build (bakes the WS URL at build time, rewrites dist):
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
// TOUCH=1 emulates a touch device (so the client renders the onscreen joystick +
// touch combat buttons) while keeping the 1280×720 layout so menu-nav coords still
// work. Lets us QA the mobile onscreen controls.
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DSF) || 2, hasTouch: process.env.TOUCH === "1" });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLEERR:", m.text()); });

// Load + let fonts and procedural sprites generate.
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(4500);

// Title is HTML now → click the DOM "Multiplayer" button (was canvas "Play Online").
await page.click('button:has-text("Multiplayer")');
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

// ESC opens the pause/settings overlay (Resume · Sound · Leave) instead of quitting.
await page.keyboard.press("Escape");
await sleep(400);
await page.screenshot({ path: `${OUT}/07-pause-menu.png` });
console.log("shot: 07-pause-menu");

await browser.close();
console.log("done");
