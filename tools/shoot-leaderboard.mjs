// Audit the title-screen "Top Extractors" leaderboard layout by injecting test rows
// (incl. a very long name) — it stays hidden when /api/leaderboard is empty (local).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8080";
mkdirSync(".screenshots", { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("#title", { timeout: 15000 });
await sleep(2500);
await page.evaluate(() => {
  const rows = [["StormChaser",42],["VoidWalker",37],["EmberQueen",31],["A_Very_Long_Tamer_Name_Here",28],["Kai",19]];
  document.getElementById("lb-list").innerHTML = rows.map((e,i)=>`<li><span>${i+1}. ${e[0]}</span><span>${e[1]}</span></li>`).join("");
  document.getElementById("leaderboard").classList.add("show");
});
await sleep(800);
await page.screenshot({ path: ".screenshots/title-leaderboard.png" });
console.log("shot");
await browser.close();
