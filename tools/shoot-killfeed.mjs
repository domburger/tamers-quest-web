// Inject a kill feed with MAX-LENGTH names (guest nicks can be 20 chars) to check whether a
// long PvP entry overflows the right gutter and bleeds over the play window (it's right-anchored
// to the minimap edge and its backing-strip width grows with the string length).
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
await page.fill("#guest-nick", "Scout"); await page.click("#guest-go"); await sleep(2200);
await page.mouse.click(640, 720 - 80); await sleep(1200);
await page.fill('input[placeholder="Character name"]', "Scout"); await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2200);
await page.mouse.click(640, 130); await sleep(2500);
await page.mouse.click(230, 150); await sleep(900);
await page.mouse.click(640, 300); await sleep(6000);
const ready = await page.evaluate(() => !!(globalThis.__net?.state?.self && globalThis.__net.state.seed != null));
console.log("in world:", ready);
if (!ready) { await shot("kf-notinworld"); await browser.close(); process.exit(0); }
await page.keyboard.down("KeyD"); await sleep(300); await page.keyboard.up("KeyD"); await sleep(400);
await page.evaluate(() => {
  const s = globalThis.__net.state;
  const now = Date.now();
  const feed = [
    { cause: "pvp", killer: "Maximilian_the_Great", victim: "Bartholomew_Bigname1", recvAt: now },
    { cause: "defeat", victim: "Wandering_Storm_Sage1", recvAt: now },
    { cause: "zone", victim: "AnotherVeryLongNamee", recvAt: now },
  ];
  Object.defineProperty(s, "killfeed", { configurable: true, get() { return feed; }, set() {} });
});
await sleep(700);
await shot("kf-longnames");
await browser.close();
console.log("done");
