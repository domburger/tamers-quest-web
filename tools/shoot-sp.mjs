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
// TOUCH=1 emulates a touch device so the SP onscreen joystick + THROW button (MB-2)
// render and the safe-area inset path (MB-4) runs; an extra `08-sp-touch` shot is
// captured after a tap reveals the controls.
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DSF) || 2, hasTouch: process.env.TOUCH === "1" });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message, "\nSTACK:", e.stack));
page.on("console", (m) => { const t = m.text(); if (/error|cannot|undefined|initial/i.test(t)) console.log("CONSOLE:", t); });
// REDUCE_MOTION=1 emulates the OS "reduce motion" a11y setting (drops the
// atmosphere drift/pulse — verifies prefersReducedMotion()); shots get an -rm suffix.
const RM = !!process.env.REDUCE_MOTION;
if (RM) await page.emulateMedia({ reducedMotion: "reduce" });
const shot = async (n) => { const f = n + (RM ? "-rm" : ""); await page.screenshot({ path: `${OUT}/${f}.png` }); console.log("shot:", f); };

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
// lobby.js layout: btnH 44, gap 10, startY = 128 + btnH/2 = 150; button i at 150 + i*54.
await page.mouse.click(640, 150);
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

// Touch controls (MB-2 joystick + THROW + MB-4 safe-area insets) only draw after
// the first touch — tap the left half to reveal them, then capture.
if (process.env.TOUCH === "1") {
  await page.touchscreen.tap(220, 360);
  await sleep(700);
  await shot("08-sp-touch");
}

await browser.close();
console.log("done");
