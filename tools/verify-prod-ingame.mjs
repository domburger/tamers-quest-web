// One-off: capture ACTUAL live gameplay on tamersquest.com to confirm the in-game
// headline visuals render for a real user — #4 brutal monsters, #5 fog-of-war,
// #6 biome minimap, #9 objective HUD. Read-only (guest + singleplayer). Throwaway QA.
import { chromium } from "playwright";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = process.env.PROD_URL || "https://tamersquest.com/";
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERR " + e.message));
p.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE " + m.text()); });
await p.goto(URL, { waitUntil: "networkidle" }); await sleep(3500);
// guest -> nickname -> character select
await p.click("#guestBtn").catch(() => {}); await sleep(600);
await p.fill("#guest-nick", "ProdCheck").catch(() => {}); await sleep(200);
await p.click("#guest-go").catch(() => {}); await sleep(2200);
// + New Character (canvas) -> name -> create
await p.mouse.click(640, 640); await sleep(700);
await p.fill('input[placeholder="Character name"]', "ProdCheck").catch(() => {}); await sleep(200);
await p.keyboard.press("Enter"); await sleep(1600);
await p.mouse.click(640, 130); await sleep(1800);          // first slot -> lobby
await p.screenshot({ path: ".screenshots/prod-3-lobby.png" });
// Play -> Singleplayer -> game (canvas coords from shot-ingame.mjs, 1280-wide)
await p.mouse.click(230, 150); await sleep(1000);          // Play
await p.mouse.click(640, 330); await sleep(7000);          // Singleplayer -> game
for (const k of ["d", "d", "s", "d", "s"]) { await p.keyboard.down(k); await sleep(420); await p.keyboard.up(k); }
await sleep(600);
await p.screenshot({ path: ".screenshots/prod-4-ingame.png" });
console.log("captured prod-3-lobby + prod-4-ingame");
console.log("page errors:", errs.length ? errs.slice(0, 8) : "none");
await b.close();
