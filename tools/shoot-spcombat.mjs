// Visual QA for the *single-player combat* scene (fight.js) — the one view the
// other harnesses can't reach reliably, because an SP encounter is RNG-gated on
// roaming onto a monster tile. This drives the SP flow to the overworld, then
// uses the DEV-only force-encounter hook (press "0", see game.js, gated behind
// import.meta.env.DEV) to jump straight into a fight, and screenshots the combat
// menu + attack-select so the themed buttons (VS-9) can be eyeballed.
//
// MUST run against the Vite DEV server (the hook is stripped from prod builds):
//   npm run dev            # Vite, usually http://localhost:5173
//   GAME_URL=http://localhost:5173 node tools/shoot-spcombat.mjs
//
// Output: .screenshots/spcombat-*.png  (.screenshots is gitignored)

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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DSF) || 2 });
let errCount = 0; // PT1-T09: fail the run (non-zero exit) if combat throws, so "10× clean" is real
page.on("pageerror", (e) => { errCount++; console.log("PAGEERR:", e.message); });
page.on("console", (m) => { const t = m.text(); if (/error|cannot|undefined/i.test(t)) console.log("CONSOLE:", t); });
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log("shot:", n); };

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 20000 });
await sleep(9000); // dev server compiles on first load

// Title → character select → new character → lobby → start run → world
// (mirrors shoot-sp.mjs's known-good nav).
// Title (FLOW screen 1): play as guest → nickname → character select.
await page.click("#guestBtn"); await page.fill("#guest-nick", "QAfighter"); await page.click("#guest-go"); await sleep(2000);
await page.mouse.click(640, 720 - 80); await sleep(1200);     // + New Character
await page.keyboard.type("QAfighter", { delay: 60 }); await sleep(500);
await page.keyboard.press("Enter"); await sleep(2000);
await page.mouse.click(640, 130); await sleep(2000);          // first slot → lobby
await page.mouse.click(640, 150); await sleep(6000);          // Start Run → world
await shot("spcombat-00-world");

// Force the nearest wild encounter via the DEV hook, then capture the fight menu.
await page.keyboard.press("0"); await sleep(2500);
await shot("spcombat-01-menu");        // Fight / Catch / Swap / Skip / Flee

// Open the attack list (Fight = top-left button at cx-110, btnY=390).
await page.mouse.click(640 - 110, 390); await sleep(1200);
await shot("spcombat-02-attacks");     // attack buttons (+ any disabled/unaffordable)

// Back to the menu, then open Swap to see the wide monster buttons.
await page.mouse.click(640, 390 + 2 * 50); await sleep(800);  // "Back" (row 3 center)
await page.mouse.click(640 - 110, 390 + 50); await sleep(1000); // "Swap" (row 2 left)
await shot("spcombat-03-swap");

// PT1-T09 coverage: actually RESOLVE a turn (the prior version only opened the
// attack list, so `evaluateTurn`/`evaluateCatch` were never exercised — the exact
// "harness-unhit path" the combat-crash blocker hid in). Drive a few real actions:
//   Fight → first attack (resolveTurn), Catch (resolveCatch + chain), Skip.
// The first attack button sits where "Fight" was (cx-110, btnY=390).
await page.mouse.click(640, 390 + 2 * 50); await sleep(500);   // Swap → Back to menu
await page.mouse.click(640 - 110, 390); await sleep(700);      // Fight → attack list
await page.mouse.click(640 - 110, 390); await sleep(2500);     // first attack → resolve a turn
await shot("spcombat-04-after-attack");
await page.mouse.click(640 + 110, 390); await sleep(2500);     // Catch (menu row1 right) → resolveCatch
await shot("spcombat-05-after-catch");
await page.mouse.click(640 + 110, 390 + 50); await sleep(2000); // Skip (menu row2 right)
console.log(errCount === 0 ? "OK: combat resolved with no client errors" : `FAIL: ${errCount} client error(s)`);

await browser.close();
process.exit(errCount === 0 ? 0 : 1);
console.log("done");
