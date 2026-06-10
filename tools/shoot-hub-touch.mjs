// Verify the HUB's TOUCH path (mobile): isTouchscreen()=true → the floating joystick + the thumb
// "USE" button. Uses a hasTouch context (so k.isTouchscreen() is true) at the desktop viewport (so
// the guest-flow coordinates match the working desktop harness), and drives movement with real
// CDP touch events. Then taps the USE button to confirm it opens the station (vault → roster).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8091";
mkdirSync(".screenshots", { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, hasTouch: true, isMobile: false });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
const shot = async (n) => { await page.screenshot({ path: `.screenshots/${n}.png` }); console.log("shot:", n); };
const client = await context.newCDPSession(page);
// One touch, snapped to a fixed push (dx,dy) for `ms` — hold-time directly controls distance, which
// is far more predictable than dragging through steps under variable headless frame timing.
async function touchHold(x, y, dx, dy, ms, shotName) {
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx, y: y + dy }] });
  if (shotName) { await sleep(Math.min(ms, 350)); await shot(shotName); await sleep(Math.max(0, ms - 350)); }
  else await sleep(ms);
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(7000);
await page.click("#guestBtn"); await sleep(600);
await page.fill("#guest-nick", "Touch"); await page.click("#guest-go"); await sleep(2500);
await page.mouse.click(640, 720 - 80); await sleep(1000);
await page.fill('input[placeholder="Character name"]', "Touch"); await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2500);
const id = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("tamers_quest_save")).characters[0].id; } catch { return null; } });
await page.evaluate((cid) => window.tqGo("hub", { characterId: cid }), id);
await sleep(2500);
const isTouch = await page.evaluate(() => { try { return !!(globalThis.__net && (("ontouchstart" in window) || navigator.maxTouchPoints > 0)); } catch { return null; } });
console.log("hasTouch(window):", isTouch);

// The VAULT is ~180px below spawn. A short full-DOWN hold (≈700ms) lands inside its reach band across
// a wide headless-speed range. The mid-hold shot captures the floating joystick; after release the
// thumb "USE" button + vault prompt persist (near=vault).
await touchHold(640, 380, 0, 90, 700, "hub-touch-joystick");
await sleep(500);
await shot("hub-touch-use"); // USE button + vault prompt, joystick released

// Tap the USE button (bottom-right) → should open the vault's roster.
const bx = 1280 - 44 - 22, by = 720 - 44 - 22;
await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: bx, y: by }] });
await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await sleep(2000);
await shot("hub-touch-roster");

await browser.close();
console.log("done");
