// Legacy out-of-lobby scenes (roster / cosmetics via tqGo) at desktop + narrow — segmented tabs check.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:5173";
const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/shots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
p.on("pageerror", (e) => console.log("PAGEERR:", e.message));
await p.goto(URL + "/", { waitUntil: "networkidle" }); await p.waitForSelector("canvas", { timeout: 20000 }); await sleep(3000);
await p.click("#guestBtn").catch(() => {}); await sleep(800); await p.fill("#guest-nick", "Scout").catch(() => {}); await p.click("#guest-go").catch(() => {}); await sleep(2500);
await p.mouse.click(640, 640); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
const charId = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem("tamers_quest_save")).characters[0].id; } catch { return null; } });
for (const scene of ["roster", "cosmetics"]) {
  await p.evaluate(([s, cid]) => window.tqGo(s, { characterId: cid, backScene: "hub" }), [scene, charId]); await sleep(1800);
  await p.screenshot({ path: `${OUT}/legacy-${scene}-desktop.png` }); console.log("shot:", scene, "desktop");
  if (scene === "roster") { await p.mouse.click(16 + 135, 28); await sleep(600); await p.screenshot({ path: `${OUT}/legacy-${scene}-tab2.png` }); console.log("shot: roster tab2 (Chains)"); }
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(1500);
  await p.screenshot({ path: `${OUT}/legacy-${scene}-narrow.png` }); console.log("shot:", scene, "narrow");
  await p.setViewportSize({ width: 1280, height: 720 }); await sleep(1200);
}
await b.close();
