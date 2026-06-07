// Reach the lobby (create a character) then open one sub-menu and screenshot it.
// Usage: TARGET=inventory|shop|settings node tools/shoot-menu.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.GAME_URL || "http://localhost:8080";
const TARGET = process.env.TARGET || "inventory";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Lobby buttons: 6 × (h56,gap14) centered (added Base Upgrades). startY = 360-40-6*70/2 = 110;
// each button center = startY + i*70.
const BTN_Y = { start: 110, inventory: 180, shop: 250, baseUpgrades: 320, settings: 390, back: 460 };

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
await page.mouse.click(640, 720 - 80); await sleep(1000);          // + New Character
await page.keyboard.type("Scout", { delay: 70 }); await sleep(500);
await page.keyboard.press("Enter"); await sleep(1500);
await page.mouse.click(640, 130); await sleep(2000);              // first char slot → lobby
await page.mouse.click(640, BTN_Y[TARGET]); await sleep(2500);    // open target menu
await shot(`menu-${TARGET}`);

await browser.close();
console.log("done");
