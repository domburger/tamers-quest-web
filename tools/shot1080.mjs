import { chromium } from "playwright";
const b = await chromium.launch({ headless: true, args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport:{width:1920,height:1080}, deviceScaleFactor:1 });
await p.goto("http://localhost:8080/",{waitUntil:"networkidle"}); await new Promise(r=>setTimeout(r,4500));
await p.screenshot({path:".screenshots/r-title-1080.png"});
// click Play Online (centered ~0.70h) to verify input maps correctly
await p.mouse.click(960, Math.round(1080*0.70)); await new Promise(r=>setTimeout(r,2500));
await p.screenshot({path:".screenshots/r-after-click.png"});
await b.close(); console.log("done");
