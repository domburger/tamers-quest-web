// Verify the FIRST-LOGIN username prompt that brand-new Google/Discord accounts get (the headline
// 2026-06-10 ask). The OAuth callback redirects to /?acct=<session>&new=1; the client opens the
// #uname-modal ("Choose your name") and POSTs the picked name to /account/username before
// character-select. Real OAuth can't run headless, so we mint a fresh (unnamed → usernameChosen
// false) account session via the signup API, then load that exact return URL — the same code path.
// Needs the combined game server: `PORT=8090 node server/index.js`, then GAME_URL=...:8090.
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

// Mint a fresh account session (no nickname → an "unnamed" account, exactly like a brand-new OAuth
// account whose nickname defaulted to the email handle and usernameChosen is still false).
const acct = await page.evaluate(async () => {
  const r = await fetch("/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "oauth" + Date.now() + "@test.local", password: "longenough1" }) });
  return (await r.json()).accountSession;
});
console.log("minted session:", acct ? "ok" : "FAILED");

// Load the exact OAuth-return URL → handleAuthReturn sees new=1 + acct → opens the username modal.
await page.goto(URL + "/?acct=" + encodeURIComponent(acct) + "&new=1", { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(8000); // let main.js init so tqAuthed exists and handleAuthReturn's apply() fires
await page.waitForSelector("#uname-modal.show", { timeout: 8000 });
await shot("oauth-username-modal"); // "Choose your name" prompt

// Pick a name → POST /account/username → character-select.
await page.fill("#uname-input", "Nova"); await sleep(200);
await page.click("#uname-go"); await sleep(2800);
await shot("oauth-username-charselect"); // indicator chip should now read "Nova"

await browser.close();
console.log("done");
