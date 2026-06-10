// Inject AI-style combat items with long names/descriptions into net.state.items (getter
// override) and open the inventory Items tab to check the slot layout (name wraps into the
// description; long descriptions overflow the 60px slot). Items are runtime-generated (unbounded).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8080";
mkdirSync(".screenshots", { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
const shot = async (n) => { await page.screenshot({ path: `.screenshots/${n}.png` }); console.log("shot:", n); };
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(8000);
await page.click("#guestBtn"); await sleep(600);
await page.fill("#guest-nick", "Scout"); await page.click("#guest-go"); await sleep(2500);
await page.mouse.click(640, 720 - 80); await sleep(1200);
await page.fill('input[placeholder="Character name"]', "Scout"); await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2500);
await page.mouse.click(640, 130); await sleep(2500);    // → lobby
await page.mouse.click(230, 225); await sleep(2200);    // Inventory
// Inject items BEFORE switching to Items tab (getter override beats any snapshot).
await page.evaluate(() => {
  const s = globalThis.__net.state;
  const items = [
    { id: "a", name: "Elixir of Boundless Everlasting Vigor", description: "Fully restores a single monster's health and energy, and cures all status ailments instantly." },
    { id: "b", name: "Thunderstone", description: "Zaps." },
    { id: "c", name: "Grand Tincture of Spectral Warding", description: "Shields the whole team from the next incoming attack for two turns." },
    { id: "d", name: "Legendary Everbright Phoenix Down of the Eternal Dawn", description: "Revives a fallen monster to full health and energy, grants it a temporary shield, boosts all of its stats for three turns, and cures every status ailment in a brilliant burst of dawnlight." },
  ];
  Object.defineProperty(s, "items", { configurable: true, get() { return items; }, set() {} });
});
await page.mouse.click(255, 28); await sleep(700);      // Items tab
await shot("items-desktop");
await page.setViewportSize({ width: 390, height: 844 }); await sleep(1200);
await shot("items-narrow");
await browser.close();
console.log("done");
