import { chromium } from "playwright";
const b = await chromium.launch({ headless:true, args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport:{width:1600,height:900}, deviceScaleFactor:2 });
await p.goto("http://localhost:8080/",{waitUntil:"networkidle"}); await new Promise(r=>setTimeout(r,3500));
const el = await p.$(".cave svg"); await el.screenshot({path:".screenshots/cave.png"}); console.log("cave shot");
await b.close();
