// Guest → character-select → "+ New Character": screenshot the character-creation
// screen at a narrow phone portrait (and tablet) to audit its layout.
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
await page.click("#guestBtn"); await sleep(700);
await page.fill("#guest-nick", "Scout"); await page.click("#guest-go"); await sleep(2800);
// "+ New Character" is a full-width button near the bottom of the char-select screen.
await page.mouse.click(W / 2, H - 66); await sleep(1800);
await shot("cc-1-create");
// try typing a name if a field is present
try { const fields = await page.$$('input'); if (fields.length) { await fields[0].fill("Aria"); await sleep(400); } } catch {}
await shot("cc-2-named");
await browser.close();
console.log("done");
