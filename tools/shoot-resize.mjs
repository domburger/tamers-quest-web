// Reproduce the orientation/resize "screwed resolution" bug: load in landscape,
// navigate to the lobby + in-game world, then flip the viewport portrait<->landscape
// mid-session and screenshot each state. Also logs the canvas backing size vs CSS size
// so we can see if the buffer/aspect goes stale after a resize.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.GAME_URL || "http://localhost:5176";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));

const canvasInfo = async (label) => {
  const info = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { bufW: c.width, bufH: c.height, cssW: Math.round(r.width), cssH: Math.round(r.height),
      winW: window.innerWidth, winH: window.innerHeight, dpr: window.devicePixelRatio };
  });
  console.log(label, JSON.stringify(info));
  return info;
};
const shot = async (n) => { await page.screenshot({ path: `${OUT}/rz-${n}.png` }); console.log("shot:", n); };

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(9000); // dev compile

// guest -> nickname -> charselect
await page.click("#guestBtn"); await sleep(500);
await page.fill("#guest-nick", "RZ"); await sleep(200);
await page.click("#guest-go"); await sleep(2500);

// create a character (bottom-center) -> name -> first slot -> lobby
const click = (x, y) => page.mouse.click(x, y);
try {
  await click(640, 720 - 80); await sleep(1200);
  await page.fill('input[placeholder="Character name"]', "RZ", { timeout: 8000 }); await sleep(300);
  await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2500);
  await click(640, 130); await sleep(2500); // first character slot -> lobby
} catch (e) { console.log("NAV-SKIP:", e.message); }

await canvasInfo("lobby-landscape:"); await shot("01-lobby-landscape");

// FLIP to portrait
await page.setViewportSize({ width: 480, height: 800 }); await sleep(900);
await canvasInfo("lobby-portrait :"); await shot("02-lobby-portrait");

// FLIP back to landscape
await page.setViewportSize({ width: 1280, height: 720 }); await sleep(900);
await canvasInfo("lobby-back-land:"); await shot("03-lobby-back-landscape");

// Try to get in-game (Play -> Singleplayer) and repeat the flip there
try {
  await click(230, 150); await sleep(900);      // Play
  await click(640, 300); await sleep(6000);      // Singleplayer -> world
  for (const key of ["KeyD", "KeyS"]) { await page.keyboard.down(key); await sleep(400); await page.keyboard.up(key); } // dismiss onboarding
  await canvasInfo("game-landscape :"); await shot("04-game-landscape");
  await page.setViewportSize({ width: 480, height: 800 }); await sleep(900);
  await canvasInfo("game-portrait  :"); await shot("05-game-portrait");
  await page.setViewportSize({ width: 1280, height: 720 }); await sleep(900);
  await canvasInfo("game-back-land :"); await shot("06-game-back-landscape");
} catch (e) { console.log("GAME-NAV-SKIP:", e.message); }

await browser.close();
console.log("done");
