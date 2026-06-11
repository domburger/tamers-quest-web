// Screenshot the character-select scene (current state + after redesign). Drives the
// guest flow, mints a character (rolls a starter team), and shoots the slot list at
// desktop + narrow-portrait widths.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:5173";
mkdirSync(".screenshots", { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const shot = async (page, n) => { await page.screenshot({ path: `.screenshots/${n}.png` }); console.log("shot:", n); };

async function run(w, h, tag) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE-ERR:", m.text()); });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas", { timeout: 15000 });
  await sleep(6000);
  await page.click("#guestBtn"); await sleep(600);
  await page.fill("#guest-nick", "Burgi"); await page.click("#guest-go"); await sleep(2500);
  // + New Character (bottom CTA), then name input
  await page.mouse.click(w / 2, h - 80); await sleep(1000);
  await page.fill('input[placeholder="Character name"]', "Burgi").catch(() => {});
  await page.press('input[placeholder="Character name"]', "Enter").catch(() => {});
  await sleep(2500);
  await shot(page, `charselect-${tag}`);
  await page.close();
}

await run(1280, 720, "wide");
await run(420, 820, "narrow");
await browser.close();
console.log("done");
