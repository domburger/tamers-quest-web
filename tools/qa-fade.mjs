// Verify the TQ-555 scene fade-in: sample a bright title pixel's luminance frame by frame after tqGo.
import { chromium } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await p.goto(URL + "/", { waitUntil: "networkidle" });
await p.waitForSelector("canvas", { timeout: 20000 }); await sleep(3000);
await p.click("#guestBtn").catch(() => {}); await sleep(800); await p.fill("#guest-nick", "Scout").catch(() => {}); await p.click("#guest-go").catch(() => {}); await sleep(2500);
await p.mouse.click(640, 640); await sleep(1200);
await p.fill('input[placeholder="Character name"]', "Scout").catch(() => {}); await p.keyboard.press("Enter"); await sleep(3000);
const charId = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem("tamers_quest_save")).characters[0].id; } catch { return null; } });
const samples = await p.evaluate((cid) => new Promise((res) => {
  const cv = document.querySelector("canvas"), ctx = cv.getContext("2d");
  const sx = Math.round(cv.width * 0.5), sy = Math.round(cv.height * 0.065); // the centred "Settings" title
  const out = []; let n = 0;
  window.tqGo("profile", { characterId: cid, backScene: "hub" }); // any full-screen scene (settings is a village popup now)
  const tick = () => { const d = ctx.getImageData(sx, sy, 1, 1).data; out.push(Math.round((d[0] + d[1] + d[2]) / 3)); if (++n < 24) requestAnimationFrame(tick); else res(out); };
  requestAnimationFrame(tick);
}), charId);
console.log("title-pixel luminance per frame:", samples.join(" "));
await b.close();
