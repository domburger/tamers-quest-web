import { chromium } from "playwright";
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on("console", (m) => console.log("CONSOLE[" + m.type() + "]:", m.text()));
p.on("pageerror", (e) => console.log("PAGEERR:", e.message, "\n", e.stack));
p.on("requestfailed", (r) => console.log("REQFAIL:", r.url(), r.failure()?.errorText));
await p.goto(process.env.GAME_URL || "http://localhost:8080/", { waitUntil: "networkidle" });
await new Promise((r) => setTimeout(r, 5000));
await b.close();
