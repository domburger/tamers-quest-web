// Authenticated login + profile capture: native email signup (with a chosen username) → the
// character-select LOGIN INDICATOR chip → the logged-in PROFILE page. Exercises the authed-only
// render paths the guest harness can't: the sign-in-method badge, the "Edit username" button, and
// the live /account/me fetch + shaping. Needs the combined game server running (it serves the
// built client + /auth + /account): `PORT=8090 node server/index.js`, then GAME_URL=...:8090.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8090";
mkdirSync(".screenshots", { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE.ERR:", m.text()); });
const shot = async (n) => { await page.screenshot({ path: `.screenshots/${n}.png` }); console.log("shot:", n); };
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(8000);

// Native signup with a username (unique-ish email so a re-run on the same in-memory server still works).
const email = `aria${Date.now()}@test.local`;
await page.click('[data-login="Tamer\'s Account"]'); await sleep(500);
await page.click("#acct-toggle"); await sleep(300);            // login -> signup (reveals the username field)
await page.fill("#acct-username", "Aria"); await sleep(120);
await page.fill("#acct-email", email); await sleep(120);
await page.fill("#acct-pass", "longenough1"); await sleep(120);
await page.click("#acct-go"); await sleep(2800);               // -> character-select (authed)
await shot("authed-charselect");                               // verify the login-indicator chip shows "Aria — View profile"

await page.evaluate(() => window.tqGo && window.tqGo("profile")); await sleep(2000);
await shot("authed-profile");                                  // providers badge "Email", Edit username, stats, empty history
await browser.close();
console.log("done");
