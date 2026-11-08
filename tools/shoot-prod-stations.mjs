// Production visual QA: jump directly to each station scene via window.tqGo (in the
// prod bundle) and screenshot it. Robust to the hub layout (no coordinate nav).
// GAME_URL overrides the target (default production).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "https://tamersquest.com";
const OUT = ".screenshots/prod";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
p.on("pageerror", (e) => console.log("PAGEERR:", e.message));
p.on("console", (m) => { const t = m.text(); if (/error|undefined|NaN|cannot/i.test(t)) console.log("CONSOLE:", t); });
await p.goto(URL + "/", { waitUntil: "networkidle" });
await p.waitForSelector("canvas", { timeout: 20000 }); await sleep(4000);
// Use the STABLE title-overlay IDs first. The auth "Stay signed in" toggle (7418164) added a
// checkbox <input> to the guest modal, so the old generic `p.fill('input', …)` now targets the
// TOGGLE not the nickname → the flow stranded on the guest modal (charId null). #guest-nick is exact.
await p.click("#guestBtn").catch(() => p.click('button:has-text("Play as guest")').catch(() => {}));
await sleep(1000);
await p.fill("#guest-nick", "Scout").catch(() => p.fill('input[placeholder="Nickname"]', "Scout").catch(() => {}));
await p.click("#guest-go").catch(() => p.click('button:has-text("Enter")').catch(() => {})); await sleep(3000);
await p.mouse.click(640, 640); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => p.mouse.click(640, 360).then(() => p.keyboard.type("Scout")));
await p.keyboard.press("Enter"); await sleep(2800);
const id = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem("tamers_quest_save")).characters[0].id; } catch { return null; } });
console.log("charId:", id);
const stations = [
  ["bestiary", {}], ["profile", {}], // the stations are village popups now; these are the remaining full-screen scenes
];
for (const [scene, extra] of stations) {
  await p.evaluate(([s, cid, ex]) => window.tqGo(s, { characterId: cid, backScene: "hub", ...ex }), [scene, id, extra]);
  await sleep(1800);
  await p.screenshot({ path: `${OUT}/${scene}.png` }); console.log("shot:", scene);
}
await b.close();
console.log("done");
