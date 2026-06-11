// Verify the "Stay signed in" toggle + smooth-resume login states.
//  (1) Title shows a "Stay signed in" checkbox, checked by default.
//  (2) Unchecking persists tq_stay_signed_in=0; the OAuth/native paths read it.
//  (3) A remembered logged-in profile makes a fresh load resume quietly (.resuming,
//      login buttons hidden, "Signing you in…" shown) instead of flashing the login UI.
//  (4) An ephemeral (don't-stay) profile whose browser session ended shows the title normally.
import { chromium } from "playwright";

const URL = process.env.GAME_URL || "http://localhost:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const fail = (m) => { console.log("FAIL:", m); failed = true; };
const ok = (m) => console.log("ok:", m);

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => { console.log("PAGEERR:", e.message); failed = true; });

// (1) checkbox present + checked by default
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#title", { timeout: 15000 });
await sleep(800);
if (!(await page.locator("#stay-signed").count())) fail("Stay-signed-in checkbox missing");
else if (!(await page.locator("#stay-signed").isChecked())) fail("checkbox not checked by default");
else ok("checkbox present + checked by default");

// (2) unchecking persists the preference
await page.click("#stay-label");
await sleep(150);
const pref = await page.evaluate(() => localStorage.getItem("tq_stay_signed_in"));
if (pref !== "0") fail(`uncheck did not persist (tq_stay_signed_in=${pref})`);
else ok("uncheck persisted tq_stay_signed_in=0");

// (3) remembered logged-in profile → quiet resume on a fresh load
await page.evaluate(() => {
  localStorage.setItem("tamers_quest_save", JSON.stringify({
    characters: [], profile: { isGuest: false, nickname: "Tamer", token: null, accountSession: "sess_demo", remember: true },
  }));
});
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#title", { timeout: 15000 });
// Read the resume state at parse time (the inline earlyResume has run; main.js hasn't yet
// auto-skipped to character-select), via computed style so it's deterministic, not race-y.
const r = await page.evaluate(() => {
  const t = document.getElementById("title");
  const note = document.querySelector(".resume-note");
  const login = document.querySelector('[data-login="Google"]');
  return {
    resuming: t.classList.contains("resuming"),
    noteDisplay: getComputedStyle(note).display,
    actionsDisplay: getComputedStyle(document.querySelector(".actions")).display,
    loginHidden: login.offsetParent === null, // null when an ancestor (.actions) is display:none
  };
});
if (!r.resuming) fail("remembered profile did not enter .resuming state");
else ok(".resuming applied on remembered profile");
if (r.actionsDisplay !== "none" || !r.loginHidden) fail(`login UI still shown while resuming (actions:${r.actionsDisplay}, loginHidden:${r.loginHidden})`);
else ok("login UI hidden while resuming");
if (r.noteDisplay !== "flex") fail(`'Signing you in…' note not shown while resuming (display:${r.noteDisplay})`);
else ok("resume note shown");

// (4) ephemeral (don't-stay) profile, browser session ended → normal title (no resume)
await page.evaluate(() => {
  sessionStorage.removeItem("tq_session_alive"); // simulate browser-restart
  localStorage.setItem("tamers_quest_save", JSON.stringify({
    characters: [], profile: { isGuest: false, nickname: "Tamer", token: null, accountSession: "sess_demo", remember: false },
  }));
});
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#title", { timeout: 15000 });
await sleep(400);
const resuming2 = await page.evaluate(() => document.getElementById("title").classList.contains("resuming"));
if (resuming2) fail("ephemeral dead-session profile incorrectly resumed (should show title)");
else ok("ephemeral dead-session shows the title normally");

await browser.close();
if (failed) { console.log("RESULT: FAILED"); process.exit(1); }
console.log("RESULT: OK — stay-signed-in + smooth-resume verified");
