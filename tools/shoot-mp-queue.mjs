// Lobby → Play → screenshot the SP/MP picker, then click Multiplayer and screenshot the
// connect→queue "waiting for players" overlay (the matchmaking screen, never SP-audited).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8080";
mkdirSync(".screenshots", { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = Number(process.env.PW) || 1280, H = Number(process.env.PH) || 720;
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
const shot = async (n) => { await page.screenshot({ path: `.screenshots/${n}.png` }); console.log("shot:", n); };
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(8000);
await page.click("#guestBtn"); await sleep(600);
await page.fill("#guest-nick", "Scout"); await page.click("#guest-go"); await sleep(2500);
await page.mouse.click(W / 2, H - 80); await sleep(1200);
await page.fill('input[placeholder="Character name"]', "Scout"); await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2500);
await page.mouse.click(W / 2, 130); await sleep(2500);   // → lobby (first character slot)
// Play (left column, first button). On wide it's left ~230; center on narrow.
await page.mouse.click(W < 700 ? W / 2 : 230, W < 700 ? 230 : 150); await sleep(1000);
await shot("mp-0-picker");
// Multiplayer button (picker: Singleplayer at my-60, Multiplayer at my+20; my=H/2).
await page.mouse.click(W / 2, H / 2 + 20); await sleep(2500);
await shot("mp-1-queue-a");
await sleep(3000);
await shot("mp-1-queue-b");
await browser.close();
console.log("done");
