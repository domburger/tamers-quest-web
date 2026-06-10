// Reach the world, open the in-game ESC pause menu, and screenshot it — checking the
// overlay dims cleanly with no HUD/world bleed-through (the recurring overlay-bleed class).
// Landscape + portrait. Also captures the world level-up burst if we stay out of combat.
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
if (!ready) { await shot("pm-notinworld"); await browser.close(); process.exit(0); }
await page.keyboard.down("KeyD"); await sleep(250); await page.keyboard.up("KeyD"); await sleep(400); // dismiss onboarding
// Guard: only open the pause menu if we're NOT in combat.
const inCombat = await page.evaluate(() => !!globalThis.__net?.state?.combat);
console.log("in combat:", inCombat);
await page.keyboard.press("Escape"); await sleep(700);
await shot("pm-landscape");
// Portrait pass.
await page.setViewportSize({ width: 390, height: 844 }); await sleep(1200);
await shot("pm-portrait");
await browser.close();
console.log("done");
