// One-off visual QA: drive the unified flow to the lobby, then open each lobby
// station (Inventory/Team, Spirit Shop, Base Upgrades, Bestiary, Cosmetics) and
// screenshot it. Reuses the proven shoot-sp nav. GAME_URL overrides the target.
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
page.on("console", (m) => { const t = m.text(); if (/error|cannot|undefined|NaN/i.test(t)) console.log("CONSOLE:", t); });
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log("shot:", n); };

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(8000);

await page.click("#guestBtn");
await sleep(600);
await page.fill("#guest-nick", "Scout");
await page.click("#guest-go");
await sleep(2500);

const click = (x, y) => page.mouse.click(x, y);
// + New Character (bottom-center) → name
await click(640, 720 - 80);
await sleep(1200);
await page.fill('input[placeholder="Character name"]', "Scout", { timeout: 8000 });
await page.press('input[placeholder="Character name"]', "Enter");
await sleep(2500);
// first character slot → lobby
await click(640, 130);
await sleep(2500);
await shot("st-00-lobby");

// Lobby stations live in the left column on wide layouts (design leftX≈230).
// Play=150, then stations at bh=46 gap=12 from colTop+~80. Indexes:
//   Inventory/Team, Spirit Shop, Base Upgrades, Healer, Bestiary, Cosmetics
const leftX = 230;
const stationY = (i) => 150 + 56 / 2 + 24 + 46 / 2 + i * (46 + 12);
const stations = [
  { name: "st-01-inventory", i: 0 },
  { name: "st-02-shop", i: 1 },
  { name: "st-03-baseupgrades", i: 2 },
  { name: "st-04-bestiary", i: 4 },
  { name: "st-05-cosmetics", i: 5 },
];
for (const s of stations) {
  await click(leftX, stationY(s.i));
  await sleep(2400);
  await shot(s.name);
  // Back button is top-RIGHT in these station scenes (design ~ width-60, 26).
  await click(1235, 28);
  await sleep(2000);
}

await browser.close();
console.log("done");
