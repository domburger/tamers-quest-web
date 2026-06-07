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

// The client hardcodes its WS to :8080 over http (see net.js), so a combined
// client+server on a non-8080 QA port would otherwise talk to the wrong server.
// Pass ?ws= so the socket targets the same server the page is served from.
const WS = (process.env.WS_URL || URL.replace(/^http/, "ws"));
const NAV = `${URL}${URL.includes("?") ? "&" : "?"}ws=${encodeURIComponent(WS)}`;

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DSF) || 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLEERR:", m.text()); });

await page.goto(NAV, { waitUntil: "networkidle" });
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
// ATTACKS=N drives a full fight to resolution (default 2) — each turn: click
// attack, let the server resolve, press Space to advance any outcome prompt
// (win/catch/faint → "tap / space"), then capture. Exercises the whole combat
// state machine (damage, crits, faint+swap, win/flee) for regression coverage.
const ATK = [166, 583];
const ATTACKS = Number(process.env.ATTACKS) || 2;
for (let i = 1; i <= ATTACKS; i++) {
  await page.mouse.click(ATK[0], ATK[1]); await sleep(3200); // server resolves the turn (AI/deterministic)
  await page.keyboard.press("Space"); await sleep(500);      // advance an outcome prompt if combat ended
  await page.screenshot({ path: `${OUT}/combat-${String(i).padStart(2, "0")}.png` });
  console.log(`shot ${i}/${ATTACKS}`);
}

await browser.close();
console.log("done");
