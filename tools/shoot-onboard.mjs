// Capture the onboarding "HOW TO PLAY" overlay (shown on first run, before moving),
// then dismiss it and inject a kill feed via the dev __net global to render it.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8080";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DSF) || 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log("shot:", n); };
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(8000);
await page.click("#guestBtn"); await sleep(600);
await page.fill("#guest-nick", "Scout"); await page.click("#guest-go"); await sleep(2200);
await page.mouse.click(640, 720 - 80); await sleep(1200);
await page.fill('input[placeholder="Character name"]', "Scout"); await sleep(300);
await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2200);
await page.mouse.click(640, 130); await sleep(2500);
await page.mouse.click(230, 190); await sleep(900);
await page.mouse.click(640, 300); await sleep(6000);

const ready = await page.evaluate(() => !!(globalThis.__net?.state?.self && globalThis.__net.state.seed != null));
console.log("in world:", ready);
if (!ready) { await shot("onboard-notinworld"); await browser.close(); process.exit(0); }

// Onboarding overlay shows on first run (fresh localStorage) before any movement.
await shot("ob-00-onboarding");

// Capture the onboarding at a small phone size too (long lines may wrap/overlap).
if (process.env.NARROW === "1") {
  await page.setViewportSize({ width: 360, height: 800 }); await sleep(900);
  await shot("ob-360-onboarding");
}

// Dismiss by moving, then inject a kill feed and screenshot it.
await page.keyboard.down("KeyD"); await sleep(400); await page.keyboard.up("KeyD"); await sleep(700);
await page.evaluate(() => {
  const now = Date.now();
  globalThis.__net.state.killfeed = [
    { cause: "pvp", killer: "Ravager", victim: "Scout", recvAt: now },
    { cause: "extracted", victim: "Wanderer", recvAt: now },
    { cause: "zone", victim: "Drifter", recvAt: now },
    { cause: "timeout", victim: "Loiterer", recvAt: now },
    { cause: "defeat", victim: "Brawler", recvAt: now },
    { cause: "disconnect", victim: "Ghost", recvAt: now },
  ];
});
await sleep(500); await shot("ob-01-killfeed");
await browser.close();
console.log("done");
