// Production smoke test: load tamersquest.com, play as a guest, create a character, reach the village, open the
// remaining full-screen scenes via tqGo, and report any page errors. No DEV hooks (prod bundle).
import { chromium } from "playwright";
const URL = process.env.GAME_URL || "https://tamersquest.com";
const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true }); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on("pageerror", (e) => errs.push(e.message.split("\n")[0]));
p.on("console", (m) => { if (m.type() === "error" && !/404|favicon|Failed to load resource/.test(m.text())) errs.push("console: " + m.text().slice(0, 160)); });
await p.goto(URL + "/", { waitUntil: "networkidle" }); await sleep(3000);
await p.click("#guestBtn"); await sleep(700); await p.fill("#guest-nick", "SmokeTest"); await p.click("#guest-go"); await sleep(3500);
await p.screenshot({ path: `${OUT}/prod-1-charselect.png` });
await p.mouse.click(640, 640); await sleep(1500); await p.fill('input[placeholder="Character name"]', "Smoke").catch(() => {}); await p.keyboard.press("Enter"); await sleep(5000);
await p.screenshot({ path: `${OUT}/prod-2-hub.png` });
const cid = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem("tamers_quest_save")).characters[0].id; } catch { return null; } });
for (const s of ["profile", "friends", "account", "characterSelect"]) { await p.evaluate(([sc, c]) => window.tqGo(sc, { characterId: c, backScene: "hub" }), [s, cid]); await sleep(1500); await p.screenshot({ path: `${OUT}/prod-3-${s}.png` }); }
console.log("character", cid ? "created" : "missing", "| errors:", errs.length ? errs.join(" || ") : "none");
await b.close();
