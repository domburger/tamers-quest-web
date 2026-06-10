// Reach the game world, then inject a roundResult into the dev-only __net client
// state to render the post-run RESULTS overlay (both the win "EXTRACTED!" and the
// loss "RUN OVER" variants) and screenshot each — auditing the result-card layout
// without playing a full run to extraction/death.
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
await page.keyboard.down("KeyD"); await sleep(300); await page.keyboard.up("KeyD"); await sleep(500);

const ready = await page.evaluate(() => !!(globalThis.__net && globalThis.__net.state && globalThis.__net.state.self && globalThis.__net.state.seed != null));
console.log("in world:", ready);
if (!ready) { await shot("results-notinworld"); await browser.close(); process.exit(0); }

const inject = (outcome, reason, gains) => page.evaluate(([o, r, g]) => {
  const s = globalThis.__net.state;
  s.roundResult = { outcome: o, reason: r, gains: g };
  s.stats = { extractions: 7, deaths: 3, caught: 24, pvpWins: 2, runs: 11 };
}, [outcome, reason, gains]);

// WIN variant — extracted with a rich gains summary.
await inject("extracted", "You reached the portal and escaped with your haul.",
  { caught: 3, xpGained: 540, levelUps: 2, survivedS: 372 });
await sleep(700); await shot("results-00-extracted");

// LOSS variant — run over (death), no gains.
await page.evaluate(() => { globalThis.__net.state.roundResult = null; });
await sleep(300);
await inject("died", "Your team was defeated. You lost the spirit chains you found this run.", null);
await sleep(700); await shot("results-01-runover");

// Narrow phone (360) — long LIFETIME/THIS RUN lines are prone to clipping.
if (process.env.NARROW === "1") {
  await page.setViewportSize({ width: 360, height: 800 }); await sleep(900);
  await page.evaluate(() => { globalThis.__net.state.roundResult = null; });
  await sleep(200);
  await inject("extracted", "You reached the portal and escaped with your haul.",
    { caught: 3, xpGained: 540, levelUps: 2, survivedS: 372 });
  await sleep(700); await shot("results-360-extracted");
}

// Inject the RAW server reason codes (what the server actually sends) to verify the card
// shows a friendly message, not "defeat"/"zone"/"timeout".
if (process.env.RAW === "1") {
  await page.evaluate(() => { globalThis.__net.state.roundResult = null; });
  await sleep(200);
  await page.evaluate(() => { globalThis.__net.state.roundResult = { outcome: "died", reason: "defeat", gains: null }; globalThis.__net.state.stats = { extractions: 7, deaths: 3, caught: 24, pvpWins: 2, runs: 11 }; });
  await sleep(600); await shot("results-rawreason");
}

await browser.close();
console.log("done");
