// Reach the new walkable HUB (camp) and screenshot it: spawn, then walk up to a few
// stations to verify the in-style structures + the proximity prompt. Drives the real
// guest flow to mint a character, reads its id from localStorage, then deep-links the
// hub via the (now args-aware) window.tqGo. Movement is driven by holding W/A/S/D.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8091";
mkdirSync(".screenshots", { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE-ERR:", m.text()); });
const shot = async (n) => { await page.screenshot({ path: `.screenshots/${n}.png` }); console.log("shot:", n); };

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(7000);
// Guest flow → character select.
await page.click("#guestBtn"); await sleep(600);
await page.fill("#guest-nick", "Scout"); await page.click("#guest-go"); await sleep(2500);
// Create a character (canvas "+ New" hit target near the bottom, then the HTML name input).
await page.mouse.click(640, 720 - 80); await sleep(1000);
await page.fill('input[placeholder="Character name"]', "Scout"); await page.press('input[placeholder="Character name"]', "Enter"); await sleep(2500);
// Grab the freshly-minted character id and deep-link the hub.
const id = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("tamers_quest_save")).characters[0].id; } catch { return null; } });
console.log("characterId:", id);
// FLIP CHECK: clicking the character card should now land on the walkable HUB (was the menu lobby).
await page.mouse.click(640, 130); await sleep(2500);
await page.mouse.click(640, 400); await sleep(300); // focus canvas
await shot("hub-via-card");
// Re-enter cleanly so the deterministic walking tests below start from a known spawn.
await page.evaluate((cid) => window.tqGo("hub", { characterId: cid }), id);
await sleep(2000);
// Focus the canvas so it receives keyboard events (after a JS-driven scene change it may not be).
await page.mouse.click(640, 400); await sleep(300);
await shot("hub-spawn");
// Joystick (desktop drives the same floating stick the touch handlers do): press-drag to spawn it.
await page.mouse.move(540, 470); await page.mouse.down();
await page.mouse.move(610, 560, { steps: 10 }); await sleep(350);
await shot("hub-joystick");
await page.mouse.up(); await sleep(200);
// Open the top-right account dropdown (Esc toggles it) to verify the account HUD.
await page.keyboard.press("Escape"); await sleep(700);
await shot("hub-acctmenu");
await page.keyboard.press("Escape"); await sleep(400);

// The VAULT sits just below spawn — a short walk DOWN reliably enters its reach. This verifies the
// proximity UI (active ring + floating [E] bubble + the fixed bottom "Press E — …" prompt). Headless
// swiftshader runs the game loop at well below realtime, so holds are generous.
await page.keyboard.down("s"); await sleep(1700); await page.keyboard.up("s"); await sleep(600);
await shot("hub-vault-near");
// Round-trip: E at the vault → roster (launched with backScene:"hub"), then Esc → back to the camp.
await page.keyboard.press("e"); await sleep(2000);
await shot("hub-vault-roster");
await page.keyboard.press("Escape"); await sleep(2000);
await page.mouse.click(640, 400); await sleep(300); // re-focus after the scene change
await shot("hub-back-from-vault");

// Reach the cave deterministically despite the unknown headless speed: walk UP until the player
// clamps against the top wall (a long hold), THEN a short walk DOWN lands inside the cave's reach
// band (well-conditioned across a wide speed range). Then open + screenshot the run picker.
await page.keyboard.down("w"); await sleep(9000); await page.keyboard.up("w"); await sleep(400);
await page.keyboard.down("s"); await sleep(1500); await page.keyboard.up("s"); await sleep(600);
await shot("hub-cave");
await page.keyboard.press("e"); await sleep(900);
await shot("hub-cave-picker");
await page.keyboard.press("Escape"); await sleep(500);

// Mobile portrait: verify the HUD (identity / currency / avatar / bottom prompts) survives a narrow
// tall viewport without colliding. Re-enter the hub cleanly, then resize.
await page.evaluate((cid) => window.tqGo("hub", { characterId: cid }), id);
await sleep(1500);
await page.setViewportSize({ width: 414, height: 896 });
await sleep(1500);
await shot("hub-portrait");

await browser.close();
console.log("done");
