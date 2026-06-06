import { chromium } from "playwright";
const b = await chromium.launch({ headless:true, args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport:{width:1600,height:900}, deviceScaleFactor:1 });
p.on("pageerror",e=>console.log("PAGEERR:",e.message));
await p.goto("https://tamersquest.com/",{waitUntil:"networkidle"}); await new Promise(r=>setTimeout(r,4000));
await p.screenshot({path:".screenshots/prod-title.png"}); console.log("shot prod-title");
await b.close();
