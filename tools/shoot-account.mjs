// Capture the native "Tamer's Account" email/password modal (#acct-modal) + its
// sign-up toggle, at desktop and a phone width.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8080";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log("shot:", n); };
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("#title", { timeout: 15000 });
await sleep(2500);
// Open the account modal.
await page.click('[data-login="Tamer\'s Account"]'); await sleep(600);
await shot("acct-00-signin");
// Toggle to sign-up mode.
await page.click("#acct-toggle"); await sleep(400);
await shot("acct-01-signup");
// Type an invalid email + submit to surface the error/validation state.
await page.click("#acct-toggle"); await sleep(300); // back to sign in
await page.fill("#acct-email", "notanemail"); await page.fill("#acct-pass", "x"); await sleep(200);
await page.click("#acct-go"); await sleep(800);
await shot("acct-02-error");
// Narrow phone.
await page.setViewportSize({ width: 360, height: 800 }); await sleep(500);
await shot("acct-360-signin");
await browser.close();
console.log("done");
