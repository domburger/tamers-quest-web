// Drive the single-player flow: create a character, enter the lobby, start a run,
// and screenshot the in-game world (shows the redesigned player + tiles).
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
// TOUCH=1 emulates a touch device so the SP onscreen joystick + THROW button (MB-2)
// render and the safe-area inset path (MB-4) runs; an extra `08-sp-touch` shot is
// captured after a tap reveals the controls.
// VW/VH override the viewport so we can QA non-16:9 aspects (e.g. portrait VW=720 VH=1280
// for WIN-T4). HIDE_ROTATE=1 injects CSS hiding the #rotate-notice "use landscape" gate so
// the portrait *canvas layout* is visible for verification before the gate is actually removed.
const VW = Number(process.env.VW) || 1280, VH = Number(process.env.VH) || 720;
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: Number(process.env.DSF) || 2, hasTouch: process.env.TOUCH === "1" });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message, "\nSTACK:", e.stack));
page.on("console", (m) => { const t = m.text(); if (/error|cannot|undefined|initial/i.test(t)) console.log("CONSOLE:", t); });
// REDUCE_MOTION=1 emulates the OS "reduce motion" a11y setting (drops the
// atmosphere drift/pulse — verifies prefersReducedMotion()); shots get an -rm suffix.
const RM = !!process.env.REDUCE_MOTION;
if (RM) await page.emulateMedia({ reducedMotion: "reduce" });
const shot = async (n) => { const f = n + (RM ? "-rm" : ""); await page.screenshot({ path: `${OUT}/${f}.png` }); console.log("shot:", f); };

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
// HIDE_ROTATE=1: hide the #rotate-notice "use landscape" gate so the portrait canvas
// layout is verifiable before the gate is actually removed (WIN-T4). Injected post-load.
if (process.env.HIDE_ROTATE === "1") await page.addStyleTag({ content: "#rotate-notice{display:none!important}" }).catch(() => {});
await sleep(9000); // dev server compiles on first load

// Title (FLOW screen 1, HTML) → Play as guest → nickname → character select
await shot("03-title"); // capture the HTML title (verifies portrait reflow of the start screen)
await page.click("#guestBtn");
await sleep(600);
await page.fill("#guest-nick", "Scout");
await sleep(300);
await page.click("#guest-go");
await sleep(2500);
await shot("04-charselect"); // capture the character-select layout (verifies portrait reflow, WIN-T5)

// Orientation-aware canvas nav: design height is always 720 (so y-coords match both
// orientations); design width = aspect·720, so center-x differs. Clicks are design
// coords × the FIT scale (= VH/720). Lets the SAME flow drive landscape AND portrait
// (WIN: verify the in-round square/HUD in portrait, which the old fixed coords couldn't).
const portrait = VH > VW;
const s = portrait ? VH / 720 : 1;
const dcx = (portrait ? Math.round((720 * VW) / VH) : 1280) / 2; // design center-x
const click = (dx, dy) => page.mouse.click(Math.round(dx * s), Math.round(dy * s));

// The canvas-coordinate nav past charselect is best-effort: on non-16:9 viewports the
// shim's pointer mapping doesn't match a simple design×scale, so a click may miss. Wrap
// it so portrait/ultrawide runs still capture the verified title + charselect instead of
// crashing the whole harness. (Landscape 1280×720 maps 1:1 and works fully.)
try {
  // + New Character (bottom-center) → name via the real DOM <input>.
  await click(dcx, 720 - 80);
  await sleep(1200);
  await page.fill('input[placeholder="Character name"]', "Scout", { timeout: 8000 });
  await sleep(400);
  await page.press('input[placeholder="Character name"]', "Enter");
  await sleep(2500);

  // Click the first character slot → lobby
  await click(dcx, 130);
  await sleep(2500);
  await shot("05-lobby");

  // Unified hub: Play → SP/MP picker → Singleplayer → loading → game world. Play sits at
  // the left column when wide (design leftX≈230) but centers when narrow/portrait; the
  // picker's "Singleplayer" is centered at design (cx, my-60 = 300).
  await click(portrait ? dcx : 230, 150);
  await sleep(900);
  await shot("05b-play-picker");
  await click(dcx, 300);
  await sleep(6000);
  await shot("06-game-world");

  // Walk around a bit (WASD) and capture motion + facing
  for (const key of ["KeyD", "KeyS", "KeyA", "KeyW"]) {
    await page.keyboard.down(key);
    await sleep(700);
    await page.keyboard.up(key);
  }
  await sleep(300);
  await shot("07-game-moved");
} catch (e) {
  console.log("NAV-SKIP (canvas nav past charselect — expected on non-16:9):", e.message);
}

// Touch controls (MB-2 joystick + THROW + MB-4 safe-area insets) only draw after
// the first touch — tap the left half to reveal them, then capture.
if (process.env.TOUCH === "1") {
  await page.touchscreen.tap(220, 360);
  await sleep(700);
  await shot("08-sp-touch");
}

await browser.close();
console.log("done");
