// Verify the MP combat overlay is *playable* end-to-end (not just rendering) — the
// flow that froze before the JOY→joyRest fix. Run against a server with a big
// encounter radius so combat triggers fast: ENCOUNTER_RADIUS=600 node server/index.js
// Enters a round → combat → clicks an attack twice, capturing the turn resolution.
// Output: .screenshots/combat-A..D.png
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.GAME_URL || "http://localhost:8080";
const NICK = process.env.NICK || "combatqa";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DSF) || 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLEERR:", m.text()); });

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(4500);
await page.mouse.click(640, Math.round(720 * 0.70)); await sleep(1200);   // Play Online
await page.fill("input", NICK).catch(() => {});
await sleep(300);
await page.mouse.click(640, Math.round(720 * 0.56)); await sleep(16000);  // Connect & Queue → round

// Nudge in case combat hasn't auto-triggered (movement locks once it has).
await page.keyboard.down("KeyD"); await sleep(900); await page.keyboard.up("KeyD");
await page.screenshot({ path: `${OUT}/combat-A.png` }); console.log("shot A (pre-attack)");

// CATCH mode (signature mechanic): Catch button rect [12, 618, 624, 54] → center ≈ (324, 645).
if (process.env.CATCH) {
  await page.mouse.click(324, 645); await sleep(3500);
  await page.screenshot({ path: `${OUT}/combat-catch.png` }); console.log("shot catch");
  await browser.close(); console.log("done"); process.exit(0);
}

// First attack button center after the combat-button overhaul (COMBAT_H 264, h 54,
// y = top+100): rect [12, 556, 308, 54] in 1280×720 → center (166, 583).
const ATK = [166, 583];
await page.mouse.click(ATK[0], ATK[1]); await sleep(3500); // server resolves the turn (AI/deterministic)
await page.screenshot({ path: `${OUT}/combat-B.png` }); console.log("shot B (after attack 1)");
await page.mouse.click(ATK[0], ATK[1]); await sleep(3500);
await page.screenshot({ path: `${OUT}/combat-C.png` }); console.log("shot C (after attack 2)");

await browser.close();
console.log("done");
