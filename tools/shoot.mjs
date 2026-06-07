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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DSF) || 2 });
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

// 4) Online lobby (title is HTML now → click the DOM "Multiplayer" button)
await load();
await page.click('button:has-text("Multiplayer")');
await sleep(2500);
await shot("04-onlinelobby");

// 5) Esc from the online lobby → back to the title (VS-15 menu-nav consistency).
// The nickname input auto-focuses, so this exercises the input-side Esc handler.
await page.keyboard.press("Escape");
await sleep(1500);
await shot("05-lobby-escape");

await browser.close();
console.log("done");
