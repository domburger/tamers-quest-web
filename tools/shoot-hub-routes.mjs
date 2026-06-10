// Verify the hub account-menu routes I just added (Bestiary / Cosmetics / Base Upgrades) actually
// open their scene and return to the camp — they were unreachable before, so the wiring is new.
// Clicks the menu item, screenshots the destination, then taps its Back and screenshots the return.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:5174";
mkdirSync(".screenshots", { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
const errs = [];
page.on("pageerror", (e) => { errs.push(e.message); console.log("PAGEERR:", e.message); });
const shot = async (n) => { await page.screenshot({ path: `.screenshots/${n}.png` }); console.log("shot:", n); };

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 20000 });
await sleep(8000);
await page.click("#guestBtn"); await sleep(700);
await page.fill("#guest-nick", "Route"); await page.click("#guest-go"); await sleep(2600);
await page.mouse.click(640, 720 - 80); await sleep(1100);
await page.fill('input[placeholder="Character name"]', "Route"); await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2600);
const id = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("tamers_quest_save")).characters[0].id; } catch { return null; } });
await page.evaluate((cid) => window.tqGo("hub", { characterId: cid }), id);
await sleep(2600);

// Guest menu order: Bestiary / Cosmetics / Base Upgrades / Settings / Switch / Log in.
// Items sit at design y = 69 + i*40, x ≈ 1162 (top-right panel). Open the menu with Esc each time
// (the destination's Back returns to the hub, so we re-open for the next route).
const routes = [["bestiary", 69], ["cosmetics", 109], ["baseupgrades", 149]];
for (const [name, y] of routes) {
  await page.keyboard.press("Escape"); await sleep(700); // open account menu
  await page.mouse.click(1162, y); await sleep(2600);      // click the menu item → scene
  await shot(`route-${name}`);
  // Return: press Escape (every one of these scenes maps Esc → Back → hub).
  await page.keyboard.press("Escape"); await sleep(2200);
  await page.mouse.click(640, 360); await sleep(300);      // refocus canvas in the hub
}
console.log("PAGEERRS:", errs.length);
await browser.close();
console.log("done");
