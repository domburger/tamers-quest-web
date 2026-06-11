// Regression: a logged-in player clicking "Enter the caves" must navigate on ONE click, even when
// clicked DURING the (sprite-heavy) boot — before main.js defines window.tqGo. The title's HTML is
// interactive from first paint, so an early click calls launch() (hides title, queues tqGo). The boot
// then used to unconditionally k.go("start") → tq:title → RE-SHOW the title over the pending nav,
// forcing a second click ("have to click Enter twice / reload-like lag"). __tqLaunching now guards
// both the boot and the tq:title handler. We also assert the inverse: a genuine Back DOES re-show it.
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

async function newSignedInPage() {
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  p.on("pageerror", (e) => { console.log("PAGEERR:", e.message); failed = true; });
  // Inject a remembered logged-in profile BEFORE any page script runs.
  await p.addInitScript(() => {
    localStorage.setItem("tamers_quest_save", JSON.stringify({
      characters: [], profile: { isGuest: false, nickname: "Tamer", token: null, accountSession: "sess_demo", remember: true },
    }));
  });
  return p;
}

// (1) Click "Enter the caves" DURING boot → single click navigates, title is NOT re-shown.
{
  const p = await newSignedInPage();
  await p.goto(`${URL}/`, { waitUntil: "commit" });
  await p.waitForSelector("#enterBtn", { timeout: 8000 });
  const tqGoReady = await p.evaluate(() => typeof window.tqGo === "function");
  await p.click("#enterBtn"); // click while still booting
  await sleep(3000);          // let boot finish + any erroneous re-show settle
  const st = await p.evaluate(() => { const t = document.getElementById("title"); return { hidden: t.classList.contains("hidden"), display: getComputedStyle(t).display }; });
  if (tqGoReady) console.log("  (note: tqGo already defined at click — race window not exercised this run)");
  if (st.display !== "none" && !st.hidden) fail(`title re-shown after one Enter click (forces a 2nd click) — ${JSON.stringify(st)}`);
  else ok("single Enter click during boot stays navigated (no re-show)");
  await p.close();
}

// (2) Regression: a genuine return to the title (in-game Back → "start" → tq:title) DOES re-show it.
{
  const p = await newSignedInPage();
  await p.goto(`${URL}/`, { waitUntil: "commit" });
  await p.waitForFunction("typeof window.tqGo==='function'", { timeout: 8000 });
  await p.click("#enterBtn"); await sleep(1500);
  await p.evaluate(() => window.tqGo("start")); await sleep(800);
  const st = await p.evaluate(() => { const t = document.getElementById("title"); return { hidden: t.classList.contains("hidden"), display: getComputedStyle(t).display, launching: window.__tqLaunching }; });
  if (st.display === "none" || st.hidden) fail(`title NOT re-shown on Back — ${JSON.stringify(st)}`);
  else ok("Back re-shows the title (regression intact)");
  await p.close();
}

await browser.close();
if (failed) { console.log("RESULT: FAILED"); process.exit(1); }
console.log("RESULT: OK — enter-the-caves is single-click; Back still returns to title");
