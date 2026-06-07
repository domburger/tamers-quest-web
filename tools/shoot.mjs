// Loop helper: drive the game in headless Chromium and screenshot each scene.
// Usage: node tools/shoot.mjs
//
// ⚠️ STALE FLOW (FLOW unification, 2026-06-07): several steps below target the
// retired flow — the title's "Multiplayer" button is gone (SP/MP is chosen in the
// unified lobby: title → guest → character → lobby → Play → Multiplayer), the
// "Enter from title" char-select shortcut now opens the guest-nickname modal, and
// the old onlineLobby Bestiary/grid coords are replaced by lobby stations. Reach
// the bestiary via the lobby's Bestiary station instead. Needs a full rewire to
// the unified lobby (see shoot-sp.mjs / shoot-round.mjs for the current nav).
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
// VW/VH override the viewport so the menu/canvas scenes can be checked at any aspect
// ratio (e.g. VW=1024 VH=768 for 4:3, or ultrawide) — verifies the responsive
// "fill any screen, no letterbox" canvas scaling (896bdb3/7ced891). Default 16:9.
const VW = Number(process.env.VW) || 1280, VH = Number(process.env.VH) || 720;
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: Number(process.env.DSF) || 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));

async function load() {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas", { timeout: 15000 });
  await sleep(4500); // fonts + procedural sprite generation
}

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("shot:", name);
}

// 1) Title
await load();
await shot("01-title");

// 2) Bestiary. The title is HTML-only now (the canvas menu + its "b" shortcut were
// removed), so the old `keyboard.press("b")` was a silent no-op that captured the
// title. Reach the bestiary via the online lobby's Bestiary button (LS-14, client-
// only — no nickname/join needed): Multiplayer → lobby → Bestiary grid button
// (onlineLobby.js: right col, row 2 = cx+110, primaryY+64+54 ≈ 750,485 @1280×720).
await page.click('button:has-text("Multiplayer")');
await sleep(2000);
await page.mouse.click(750, 485);
await sleep(2000);
await shot("02-bestiary");

// 3) Character select (Enter from title)
await load();
await page.keyboard.press("Enter");
await sleep(2000);
await shot("03-characterselect");

// 4) Online lobby (title is HTML now → click the DOM "Multiplayer" button)
await load();
await page.click('button:has-text("Multiplayer")');
await sleep(2500);
await shot("04-onlinelobby");

// 5) Esc from the online lobby → back to the title (VS-15 menu-nav consistency).
// The nickname input auto-focuses, so this exercises the input-side Esc handler.
await page.keyboard.press("Escape");
await sleep(1500);
await shot("05-lobby-escape");

await browser.close();
console.log("done");
