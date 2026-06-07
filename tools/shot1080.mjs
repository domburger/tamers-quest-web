import { chromium } from "playwright";
const b = await chromium.launch({ headless: true, args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport:{width:1920,height:1080}, deviceScaleFactor:1 });
await p.goto("http://localhost:8080/",{waitUntil:"networkidle"}); await new Promise(r=>setTimeout(r,4500));
await p.screenshot({path:".screenshots/r-title-1080.png"});
// title is HTML now → click the DOM "Multiplayer" button, then the lobby (canvas)
// renders at 1080p so its screenshot verifies canvas input/scale mapping.
await p.click('button:has-text("Multiplayer")'); await new Promise(r=>setTimeout(r,2500));
await p.screenshot({path:".screenshots/r-after-click.png"});
await b.close(); console.log("done");
