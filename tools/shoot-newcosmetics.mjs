// Headless screenshot of the new cosmetics — jumps straight to the cosmetics scene
// via window.tqGo (no brittle onboarding clicks). Serves the built dist on :8099.
// The shim renders a virtual 1280x720 design scaled FIT to the window, so click/scroll
// coords are design coords * scale (scale = innerWidth / round(720*aspect)).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const ROOT = new URL("../dist/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".ttf": "font/ttf" };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const buf = await readFile(join(ROOT, p));
    res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
    res.end(buf);
  } catch { res.writeHead(404); res.end("nf"); }
});
await new Promise((r) => server.listen(8099, r));

const OUT = ".screenshots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VW = 1280, VH = 1400;
const designW = Math.round(720 * (VW / VH));
const scale = VW / designW;               // design px → CSS px
const px = (dx, dy) => [Math.round(dx * scale), Math.round(dy * scale)];

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
await page.goto("http://localhost:8099", { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 15000 });
await sleep(6000);
await page.evaluate(() => {
  window.tqGo("cosmetics", { backScene: "start" });
  const t = document.getElementById("title"); if (t) t.classList.add("hidden"); // uncover the canvas
});
await sleep(1500);
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log("shot:", n); };
const [cx, cy] = px(640, 360);
const deepScroll = async (n) => { await page.mouse.move(cx, cy); for (let i = 0; i < n; i++) { await page.mouse.wheel(0, 1400); await sleep(250); } await sleep(600); };

// Spirit Chains tab — top, then deep-scrolled to the newest skins.
await shot("new-chains-top");
await deepScroll(4); await shot("new-chains-mid");
await deepScroll(6); await shot("new-chains-bottom");

// Player Character tab.
const [tx, ty] = px(309, 89);
await page.mouse.click(tx, ty); await sleep(1200);
await shot("new-characters-top");
await deepScroll(6); await shot("new-characters-mid");
await deepScroll(8); await shot("new-characters-bottom");

await browser.close();
server.close();
console.log("done");
