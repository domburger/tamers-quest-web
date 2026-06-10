// Screenshot each camp STATION up close by teleporting the player next to it (window.__hubTele, a
// DEV-only hook) — headless frame-timing makes walking to a specific station unreliable. Runs against
// a Vite DEV server (where the hook is live). Set GAME_URL to the dev server.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:5174";
mkdirSync(".screenshots", { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE-ERR:", m.text()); });
const shot = async (n) => { await page.screenshot({ path: `.screenshots/${n}.png` }); console.log("shot:", n); };

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 20000 });
await sleep(9000);
await page.click("#guestBtn"); await sleep(700);
await page.fill("#guest-nick", "Art"); await page.click("#guest-go"); await sleep(2600);
await page.mouse.click(640, 720 - 80); await sleep(1100);
await page.fill('input[placeholder="Character name"]', "Art"); await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2600);
const id = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("tamers_quest_save")).characters[0].id; } catch { return null; } });
console.log("characterId:", id);
await page.evaluate((cid) => window.tqGo("hub", { characterId: cid }), id);
await sleep(2600);
console.log("hasTele:", await page.evaluate(() => typeof window.__hubTele === "function"));

// Teleport the player just IN FRONT of each station (in reach), then clip a close-up around the
// station so the detail is legible (the full 2560px frame gets downscaled when viewed).
const stations = {
  merchant: { world: [1680, 760],  tele: [1680, 858] },
  healer:   { world: [720, 880],   tele: [720, 978] },
  cave:     { world: [1240, 520],  tele: [1240, 624] },
  vault:    { world: [1720, 1440], tele: [1720, 1538] },
};
for (const [name, { world, tele }] of Object.entries(stations)) {
  await page.evaluate(([x, y]) => window.__hubTele && window.__hubTele(x, y), tele);
  await sleep(1000);
  const cyDesign = 360 + (world[1] - tele[1]); // station's screen-y in design px (camera on the player)
  const w = 560, h = 540, cx = 640;
  await page.screenshot({ path: `.screenshots/st-${name}.png`, clip: { x: cx - w / 2, y: Math.max(0, cyDesign - h / 2 - 40), width: w, height: h } });
  console.log("shot:", name);
}
await browser.close();
console.log("done");
