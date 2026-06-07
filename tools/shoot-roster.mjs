// Visual QA for the ONLINE roster scene (Team & Vault + the new Spirit Chains
// tab). Drives: title → Play Online → online lobby → Manage Team → roster, then
// screenshots the Monsters tab and the Spirit Chains tab (tap-to-equip inventory).
// Needs a combined server on :8080 (the client hardcodes ws://localhost:8080 for
// http origins). Output: .screenshots/08-roster-monsters.png, 09-roster-chains.png
//
// ⚠️ STALE FLOW (FLOW unification, 2026-06-07): the title no longer has a
// "Multiplayer" button — SP/MP is chosen in the unified lobby now (title → guest →
// character → lobby → Play → Multiplayer). The old onlineLobby "Manage Team" grid
// this harness clicks is retired; roster/shop are direct lobby stations. Rewire to
// the unified flow once the owner decides onlineRoster/onlineShop's fate (the
// lobby stations may open the local roster/shop synced to the server instead).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.GAME_URL || "http://localhost:8080";
const NICK = process.env.NICK || "rostercheck";
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

// Title is HTML now → click the DOM "Multiplayer" button (was canvas "Play Online").
await page.click('button:has-text("Multiplayer")');
await sleep(1200);

// Online lobby (LS-14 layout): primary CTA at 0.51h, then a 2-col management grid.
// "Manage Team" is grid cell 0 — left col (x = 640-110), row 0 (y = 0.51h+64). It
// connects+joins, then transitions to the roster.
await page.fill("input", NICK).catch(() => {});
await sleep(300);
await page.mouse.click(640 - 110, Math.round(720 * 0.51) + 64);
console.log("waiting for connect + join + roster…");
await sleep(4000);
await page.screenshot({ path: `${OUT}/08-roster-monsters.png` });
console.log("shot: 08-roster-monsters");

// Switch to the Spirit Chains tab (header tab button ≈ (213, 28)).
await page.mouse.click(213, 28);
await sleep(800);
await page.screenshot({ path: `${OUT}/09-roster-chains.png` });
console.log("shot: 09-roster-chains");

// Tap the (only) starter chain card to exercise equip (top-left card ≈ (300, 140)).
await page.mouse.click(300, 140);
await sleep(500);
await page.screenshot({ path: `${OUT}/10-roster-chains-equip.png` });
console.log("shot: 10-roster-chains-equip");

await browser.close();
console.log("done");
