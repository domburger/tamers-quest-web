// Drive the single-player flow: create a character, enter the lobby, start a run,
// and screenshot the in-game world (shows the redesigned player + tiles).
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message, "\nSTACK:", e.stack));
page.on("console", (m) => { const t = m.text(); if (/error|cannot|undefined|initial/i.test(t)) console.log("CONSOLE:", t); });
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log("shot:", n); };

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(9000); // dev server compiles on first load

// Title → character select
await page.keyboard.press("Enter");
await sleep(2500);

// + New Character (bottom-center button), type a name, confirm
await page.mouse.click(640, 720 - 80);
await sleep(1500);
await page.keyboard.type("Scout", { delay: 80 });
await sleep(700);
await page.keyboard.press("Enter");
await sleep(2500);

// Click the first character slot → lobby
await page.mouse.click(640, 130);
await sleep(2500);
await shot("05-lobby");

// Start Run (first lobby button) → loading → game world.
// Lobby lays out 5 buttons (h56,gap14) centered: startY = H/2 - 40 - 5*70/2.
await page.mouse.click(640, 360 - 40 - (5 * 70) / 2);
await sleep(6000);
await shot("06-game-world");

// Walk around a bit (WASD) and capture motion + facing
for (const key of ["KeyD", "KeyS", "KeyA", "KeyW"]) {
  await page.keyboard.down(key);
  await sleep(700);
  await page.keyboard.up(key);
}
await sleep(300);
await shot("07-game-moved");

await browser.close();
console.log("done");
