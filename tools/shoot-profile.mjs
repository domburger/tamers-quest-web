// Screenshot the PROFILE page (login indicator's detail view: avatar, player data, match
// history). Boots as a guest, creates one character for data, then jumps straight to the
// profile scene via window.tqGo (the in-UI "View profile" chip is account-only). Desktop +
// narrow portrait so the responsive single-column layout is verified on both.
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
// Create one character so the player-data panel has a slot to summarize.
await page.mouse.click(640, 720 - 64); await sleep(1100);
await page.fill('input[placeholder="Character name"]', "Riven"); await sleep(250);
await page.press('input[placeholder="Character name"]', "Enter"); await sleep(1600);
// Jump to the profile scene (the in-UI chip is shown to logged-in accounts only).
await page.evaluate(() => window.tqGo && window.tqGo("profile")); await sleep(1800);
await shot("profile-desktop");
await page.setViewportSize({ width: 360, height: 740 }); await sleep(1200);
await shot("profile-narrow");
await browser.close();
console.log("done");
