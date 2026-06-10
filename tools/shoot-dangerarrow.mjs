// Inject a small safe-zone circle to the player's LEFT (player outside it) so the "OUTSIDE SAFE
// ZONE" danger arrow points LEFT — into the landscape left gutter where the team HUD + objective
// live — to check whether the screen-edge arrow overlaps that HUD (the portal compass had the same
// screen-vs-square footgun). DIR=up/right/down via env to test other gutters.
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
await page.mouse.click(230, 190); await sleep(900);
await page.mouse.click(640, 300); await sleep(6000);
const ready = await page.evaluate(() => !!(globalThis.__net?.state?.self && globalThis.__net.state.seed != null));
console.log("in world:", ready);
if (!ready) { await shot("da-notinworld"); await browser.close(); process.exit(0); }
await page.mouse.click(640, 360); await sleep(1000);
const DIR = process.env.DIR || "left"; // direction of the safe zone relative to the player
await page.evaluate((dir) => {
  const s = globalThis.__net.state;
  const off = { left: [-420, 0], right: [420, 0], up: [0, -420], down: [0, 420] }[dir] || [-420, 0];
  Object.defineProperty(s, "circle", { configurable: true,
    get() { return s.self ? { x: s.self.x + off[0], y: s.self.y + off[1], r: 150 } : null; }, set() {} });
}, DIR);
const tag = process.env.PORTRAIT === "1" ? `da-${DIR}-portrait` : `da-${DIR}`;
if (process.env.PORTRAIT === "1") { await page.setViewportSize({ width: 390, height: 844 }); await sleep(1200); }
await sleep(900); await shot(tag);
await browser.close();
console.log("done");
