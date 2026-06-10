// Reach the world and screenshot the first-run ONBOARDING overlay WITHOUT dismissing it
// (don't press a movement key). Shows for a fresh context (no tq_onboarded localStorage).
// Landscape + portrait, to audit the tutorial card layout + that the HUD is gated behind it.
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
console.log("in world:", ready, "onboarded:", await page.evaluate(() => { try { return !!localStorage.getItem("tq_onboarded"); } catch { return "n/a"; } }));
if (!ready) { await shot("ob-notinworld"); await browser.close(); process.exit(0); }
// Force the OUTSIDE-zone danger state (getter override, beats the 15Hz snapshot) so the
// danger banner/border/arrow WOULD fire — verifying they're gated behind onboarding.
await page.evaluate(() => {
  const s = globalThis.__net.state;
  Object.defineProperty(s, "circle", { configurable: true,
    get() { return s.self ? { x: s.self.x + 400, y: s.self.y, r: 180 } : null; }, set() {} });
});
await sleep(400);
await shot("ob-landscape"); // do NOT press a movement key — keep the overlay up
await page.setViewportSize({ width: 390, height: 844 }); await sleep(1200);
await shot("ob-portrait");
await browser.close();
console.log("done");
