// Title → "Tamer's Account": screenshot the native email/password sign-in form (login +
// the sign-up toggle), at desktop and narrow portrait. An entry screen every native user hits.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:8080";
mkdirSync(".screenshots", { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
const shot = async (n) => { await page.screenshot({ path: `.screenshots/${n}.png` }); console.log("shot:", n); };
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("#title", { timeout: 15000 });
await sleep(3500);
await page.click('button.login[data-login="Tamer\'s Account"]'); await sleep(800);
await shot("acct-form-login");
// Toggle to sign-up mode (the "Create your account" link).
const toggle = await page.$("#acct-toggle");
if (toggle) { await toggle.click(); await sleep(600); await shot("acct-form-signup"); }
// Narrow portrait pass.
await page.setViewportSize({ width: 360, height: 740 }); await sleep(800);
await shot("acct-form-narrow");
await browser.close();
console.log("done");
