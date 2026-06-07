import { chromium } from "playwright";
const b = await chromium.launch({ headless: true, args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport:{width:1920,height:1080}, deviceScaleFactor:1 });
await p.goto("http://localhost:8080/",{waitUntil:"networkidle"}); await new Promise(r=>setTimeout(r,4500));
await p.screenshot({path:".screenshots/r-title-1080.png"});
// FLOW: title → "Play as guest" → character select (a canvas scene) renders at
// 1080p, verifying canvas input/scale mapping at a non-720p resolution. (Title
// clicks are HTML/physical-pixel, so they're resolution-robust.)
await p.click("#guestBtn"); await p.fill("#guest-nick","QA1080"); await p.click("#guest-go");
await new Promise(r=>setTimeout(r,2500));
await p.screenshot({path:".screenshots/r-after-click.png"});
await b.close(); console.log("done");
