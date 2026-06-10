// Audit the SQUARE aspect (1:1) in-world: no gutters, so the HUD falls back to tucking onto the
// square edges (hudLayout square branch) and the controls hint shows (orientation==="square").
// A distinct layout vs landscape (L/R gutters) / portrait (T/B gutters). Resize in-world (live).
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
await page.fill("#guest-nick", "Scout"); await page.click("#guest-go"); await sleep(2200);
await page.mouse.click(640, 720 - 80); await sleep(1200);
await page.fill('input[placeholder="Character name"]', "Scout"); await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2200);
await page.mouse.click(640, 130); await sleep(2500);
await page.mouse.click(230, 150); await sleep(900);
await page.mouse.click(640, 300); await sleep(6000);
const ready = await page.evaluate(() => !!(globalThis.__net?.state?.self && globalThis.__net.state.seed != null));
console.log("in world:", ready);
if (!ready) { await shot("sq-notinworld"); await browser.close(); process.exit(0); }
await page.mouse.click(640, 360); await sleep(700);
// circle=null → the LONGEST objective ("Objective: catch monsters and loot chests, then extract
// before the storm closes") — widest case vs the top-right minimap in the square layout.
await page.evaluate(() => { Object.defineProperty(globalThis.__net.state, "circle", { configurable: true, get(){return null;}, set(){} }); });
await page.setViewportSize({ width: 760, height: 760 }); await sleep(1400); // ~1:1 square aspect
await shot("sq-world");
await browser.close();
console.log("done");
