// Visual QA for the MP *combat overlay* — the core gameplay screen that shoot-round
// never reaches (combat is gated on bumping/throwing at a monster). Enters a round,
// then roams in changing directions and throws the starter chain (Q, ~160px range)
// to engage a monster; once combat starts the overlay appears and we capture it.
// Best-effort (encounter is position-gated) — run on a fresh :8080 (solo round env).
// Output: .screenshots/combat-NN.png
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.GAME_URL || "http://localhost:8080";
const NICK = process.env.NICK || "combatqa";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLEERR:", m.text()); });

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(4500);
await page.mouse.click(640, Math.round(720 * 0.70)); await sleep(1200);   // Play Online
await page.fill("input", NICK).catch(() => {});
await sleep(300);
await page.mouse.click(640, Math.round(720 * 0.56)); await sleep(16000);  // Connect & Queue → round

// Roam + throw to engage a monster. Sweep directions; press Q (throw) each step.
const dirs = ["KeyD", "KeyS", "KeyA", "KeyW"];
for (let i = 0; i < 30; i++) {
  const key = dirs[i % dirs.length];
  await page.keyboard.down(key);
  await sleep(700);
  await page.keyboard.up(key);
  await page.keyboard.press("KeyQ"); // throw the equipped chain along facing
  await sleep(250);
  if (i % 3 === 0) await page.screenshot({ path: `${OUT}/combat-${String(i).padStart(2, "0")}.png` });
}
await page.screenshot({ path: `${OUT}/combat-final.png` });
await browser.close();
console.log("done");
