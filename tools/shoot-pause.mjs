// Reach the world, dismiss onboarding, open the Esc pause menu, screenshot it.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8080";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DSF) || 2 });
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
await page.mouse.click(230, 190); await sleep(900);
await page.mouse.click(640, 300); await sleep(6000);
const ready = await page.evaluate(() => !!(globalThis.__net?.state?.self && globalThis.__net.state.seed != null));
console.log("in world:", ready);
if (!ready) { await shot("pause-notinworld"); await browser.close(); process.exit(0); }
// Dismiss onboarding by moving.
await page.keyboard.down("KeyD"); await sleep(400); await page.keyboard.up("KeyD"); await sleep(800);
// Open the pause menu.
await page.keyboard.press("Escape"); await sleep(700);
await shot("pause-00-menu");
// Second screenshot: arm "Leave round" (two-step) to capture the danger state.
await page.mouse.click(640, 360 - 64 + (56 + 16) * 2 + 28); await sleep(500);
await shot("pause-01-leavearm");
// Narrow phone — verify the menu fits at 360.
if (process.env.NARROW === "1") {
  await page.setViewportSize({ width: 360, height: 800 }); await sleep(900);
  await shot("pause-360");
}
await browser.close();
console.log("done");
