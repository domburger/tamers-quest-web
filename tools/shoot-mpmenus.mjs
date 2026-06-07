// Visual QA for the MP between-rounds menus that no other harness reaches: the
// online roster ("Manage Team") and the online Spirit Shop. Drives title →
// Multiplayer → nickname → Manage Team (joins the server, no queue) → roster,
// then back → Spirit Shop → onlineShop. Needs a running server at GAME_URL
// (joining only mints an in-memory profile; it does NOT enter matchmaking).
//
//   GAME_URL=http://localhost:8080 node tools/shoot-mpmenus.mjs
//
// Output: .screenshots/mp-roster.png, mp-shop.png  (.screenshots is gitignored)

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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DSF) || 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLEERR:", m.text()); });
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log("shot:", n); };

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(4500);

// Title (HTML) → online lobby.
await page.click('button:has-text("Multiplayer")');
await sleep(2000);
await page.fill("input", "MenuQA").catch(() => {});
await sleep(300);

// "Manage Team" (LS-14 grid cell 0: left col x=640-110, row 0 y=0.51h+64=431) → connect+join → roster.
await page.mouse.click(640 - 110, Math.round(720 * 0.51) + 64);
await sleep(5000);
await shot("mp-roster");

// Roster back button (top-right: [width-96, 12, 82, 34]) → onlineLobby.
await page.mouse.click(1225, 29);
await sleep(2000);

// "Spirit Shop" (LS-14 grid cell 1: right col x=640+110, row 0 y=0.51h+64) → onlineShop.
await page.mouse.click(640 + 110, Math.round(720 * 0.51) + 64);
await sleep(3000);
await shot("mp-shop");

// onlineShop back (top-right) → onlineLobby, then "Base Upgrades" (LS-14 grid cell 2:
// left col x=640-110, row 1 y=0.51h+64+54=485) → onlineBaseUpgrades (CN-1).
await page.mouse.click(1225, 29);
await sleep(2000);
await page.mouse.click(640 - 110, Math.round(720 * 0.51) + 64 + 54);
await sleep(3000);
await shot("mp-upgrades");

await browser.close();
console.log("done");
