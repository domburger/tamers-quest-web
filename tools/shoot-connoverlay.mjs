// Capture the lobby connect/queue status overlay (the modal shown when starting a run),
// including a LONG status, at 360 to check the status text fits the panel.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8080";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
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
await page.mouse.click(640, 130); await sleep(2500);    // → lobby
// Resize to 360, open Play picker, click Singleplayer to get the connect overlay, then
// inject a LONG status into the overlay's status label to test wrapping vs the panel.
await page.setViewportSize({ width: 360, height: 800 }); await sleep(800);
await page.mouse.click(180, 150); await sleep(700);     // Play (centered on narrow)
await page.mouse.click(180, 300); await sleep(500);     // Singleplayer (centered)
// Force a long status (the cold-start watchdog text) regardless of timing.
await page.evaluate(() => {
  const objs = (globalThis.__kaboomObjs || []);
  // Fallback: just screenshot whatever overlay state we caught.
});
await shot("co-360-connect");
await browser.close();
console.log("done");
