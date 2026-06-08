// Reach the lobby (create a character) then open one sub-menu and screenshot it.
// Usage: TARGET=inventory|shop|settings node tools/shoot-menu.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.GAME_URL || "http://localhost:8080";
const TARGET = process.env.TARGET || "inventory";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Lobby is the multi-column hub (lobby.js, wide ≥920px). LEFT column (leftX≈230): Play at
// y=150, then the stations at y=225+i*58 (Inventory, Spirit Shop, Base Upgrades, Bestiary,
// Cosmetics). RIGHT column (rightX≈1050): Settings at y=200, Switch Character below. Map each
// target to its [x,y] (was a single x=640 column — stale since the hub went multi-column).
const TARGETS = {
  inventory:    [230, 225],
  shop:         [230, 283],
  baseUpgrades: [230, 341],
  bestiary:     [230, 399],
  cosmetics:    [230, 457],
  settings:     [1050, 200],
};

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DSF) || 2 });
page.on("console", (m) => { const t = m.text(); if (/error|cannot|undefined|initial/i.test(t)) console.log("CONSOLE:", t); });
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log("shot:", n); };

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(5000);
// Title (FLOW screen 1): play as guest → nickname → character select.
await page.click("#guestBtn"); await page.fill("#guest-nick", "Scout"); await page.click("#guest-go"); await sleep(1500);
await page.mouse.click(640, 720 - 64); await sleep(1000);          // + New Character (bottom-center)
await page.fill('input[placeholder="Character name"]', "Scout", { timeout: 8000 }); await sleep(400); // DOM input (deterministic vs auto-focus race)
await page.keyboard.press("Enter"); await sleep(1500);
await page.mouse.click(640, 130); await sleep(2000);              // first char slot → lobby
const [tx, ty] = TARGETS[TARGET] || TARGETS.inventory;
await page.mouse.click(tx, ty); await sleep(2500);                // open target menu (multi-column hub)
await shot(`menu-${TARGET}`);

await browser.close();
console.log("done");
