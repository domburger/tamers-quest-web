// Walk the entry flow at a NARROW phone portrait (360x740) and screenshot each step:
// title → guest panel → character-name prompt → lobby. Every new user hits these first.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8080";
mkdirSync(".screenshots", { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = Number(process.env.PW) || 360, H = Number(process.env.PH) || 740;
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
const shot = async (n) => { await page.screenshot({ path: `.screenshots/${n}.png` }); console.log("shot:", n); };
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(7000);
await shot("ef-1-title");
await page.click("#guestBtn"); await sleep(700);
await shot("ef-2-guestpanel");
await page.fill("#guest-nick", "Scout"); await page.click("#guest-go"); await sleep(2500);
await shot("ef-3-aftername");        // character-name prompt or char select
// dismiss/confirm character name if the prompt is up
try { await page.fill('input[placeholder="Character name"]', "Scout", { timeout: 1500 }); await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2500); } catch {}
await shot("ef-4-lobby");
await browser.close();
console.log("done");
