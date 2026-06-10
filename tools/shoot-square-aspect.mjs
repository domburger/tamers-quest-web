// Audit the SQUARE-ASPECT HUD fallback (hudLayout square branch): near-square windows
// have gutters < MIN_SIDE_GUTTER so the HUD tucks onto the square's edges instead.
// Reach the world in landscape (reliable), then resize to a near-square aspect.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8080";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log("shot:", n); };
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(8000);
await page.click("#guestBtn"); await sleep(600);
await page.fill("#guest-nick", "Scout"); await page.click("#guest-go"); await sleep(2200);
await page.mouse.click(640, 720 - 80); await sleep(1200);
await page.fill('input[placeholder="Character name"]', "Scout"); await sleep(300);
await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2200);
await page.mouse.click(640, 130); await sleep(2500);
await page.mouse.click(230, 150); await sleep(900);
await page.mouse.click(640, 300); await sleep(6000);
const ready = await page.evaluate(() => !!(globalThis.__net?.state?.self && globalThis.__net.state.seed != null));
console.log("in world:", ready);
if (!ready) { await shot("sq-notinworld"); await browser.close(); process.exit(0); }
await page.keyboard.down("KeyD"); await sleep(400); await page.keyboard.up("KeyD"); await sleep(600);
// Near-square: 760x720 → square size 720, side gutter = (760-720)/2 = 20 < 150 → square fallback HUD.
await page.setViewportSize({ width: 760, height: 720 }); await sleep(1200);
const orient = await page.evaluate(() => { try { return globalThis.__hudOrient || null; } catch { return null; } });
await shot("sq-00-square-aspect");
await browser.close();
console.log("done");
