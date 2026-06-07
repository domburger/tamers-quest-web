// Verify the rebuilt TITLE flow (FLOW screen 1): the title offers ONLY
// "Play as guest" + login (no Singleplayer/Multiplayer); guest → nickname →
// a guest profile (isGuest:true) → character select. Captures screenshots and
// asserts the storage model is marked guest. Exits non-zero on any failure.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.GAME_URL || "http://localhost:8080";
const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = false;
const fail = (m) => { console.log("FAIL:", m); failed = true; };

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DSF) || 2 });
page.on("pageerror", (e) => { console.log("PAGEERR:", e.message); failed = true; });
page.on("console", (m) => { const t = m.text(); if (/error|cannot|undefined/i.test(t)) console.log("CONSOLE:", t); });
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log("shot:", n); };

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("#title", { timeout: 15000 });
await sleep(1500);
await shot("title-00-overlay");

// (1) Title shows ONLY guest + login — no Singleplayer/Multiplayer buttons.
if (await page.locator('button:has-text("Singleplayer")').count()) fail("Singleplayer button still on title");
if (await page.locator('button:has-text("Multiplayer")').count()) fail("Multiplayer button still on title");
if (!(await page.locator("#guestBtn").count())) fail("Play-as-guest button missing");
if (!(await page.locator('[data-login="Google"]').count())) fail("Login options missing");

// (2) Guest → nickname modal opens (mobile-keyboard-friendly <input>).
await page.click("#guestBtn");
await sleep(500);
if (!(await page.locator("#guest-modal.show").count())) fail("guest modal did not open");
const focused = await page.evaluate(() => document.activeElement === document.getElementById("guest-nick"));
if (!focused) fail("nickname input not focused (mobile keyboard would not open)");
await shot("title-01-guest-modal");

// (3) Enter a nickname → confirm → lands in character select.
await page.fill("#guest-nick", "Wanderer");
await page.click("#guest-go");
await sleep(2500);
await shot("title-02-character-select");

// (4) Profile is persisted as a guest with that nickname.
const profile = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("tamers_quest_save")).profile; } catch { return null; }
});
console.log("stored profile:", JSON.stringify(profile));
if (!profile || profile.isGuest !== true) fail("profile not marked isGuest:true");
if (!profile || profile.nickname !== "Wanderer") fail("nickname not stored on profile");

// (5) Title is hidden (we routed away to character select).
if (!(await page.locator("#title.hidden").count())) fail("title overlay still visible after guest entry");

await browser.close();
if (failed) { console.log("RESULT: FAILED"); process.exit(1); }
console.log("RESULT: OK — title flow verified");
