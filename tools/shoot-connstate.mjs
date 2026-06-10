// Audit the in-game connection-state overlays (RECONNECTING… / CONNECTION LOST) by
// injecting net.state.connected=false via the dev __net global. Captures wide + 360.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8080";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
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
await page.mouse.click(230, 150); await sleep(900);
await page.mouse.click(640, 300); await sleep(6000);
const ready = await page.evaluate(() => !!(globalThis.__net?.state?.self && globalThis.__net.state.seed != null));
console.log("in world:", ready);
if (!ready) { await shot("cs-notinworld"); await browser.close(); process.exit(0); }
await page.keyboard.down("KeyD"); await sleep(300); await page.keyboard.up("KeyD"); await sleep(500);

const setConn = (connected, reconnecting) => page.evaluate(([c, r]) => {
  const s = globalThis.__net.state; s.connected = c; s.reconnecting = r;
}, [connected, reconnecting]);

// RECONNECTING (transient, lighter dim)
await setConn(false, true); await sleep(500); await shot("cs-00-reconnecting");
// CONNECTION LOST (gave up, heavier dim)
await setConn(false, false); await sleep(400); await shot("cs-01-connlost");
// 360 narrow
await page.setViewportSize({ width: 360, height: 800 }); await sleep(700);
await setConn(false, false); await sleep(300); await shot("cs-360-connlost");
await setConn(false, true); await sleep(300); await shot("cs-360-reconnecting");
await browser.close();
console.log("done");
