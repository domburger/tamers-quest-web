// Loop helper: drive the game in headless Chromium and screenshot each scene.
// Usage: node tools/shoot.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.GAME_URL || "http://localhost:8080";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));

async function load() {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas", { timeout: 15000 });
  await sleep(4500); // fonts + procedural sprite generation
}

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("shot:", name);
}

// 1) Title
await load();
await shot("01-title");

// 2) Bestiary (press B from title)
await page.keyboard.press("b");
await sleep(2000);
await shot("02-bestiary");

// 3) Character select (Enter from title)
await load();
await page.keyboard.press("Enter");
await sleep(2000);
await shot("03-characterselect");

// 4) Online lobby (click "Play Online" — centered button)
await load();
await page.mouse.click(640, Math.round(720 * 0.70));
await sleep(2500);
await shot("04-onlinelobby");

await browser.close();
console.log("done");
