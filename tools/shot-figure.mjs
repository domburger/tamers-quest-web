import { chromium } from "playwright";
const b = await chromium.launch({ headless:true, args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport:{width:1600,height:900}, deviceScaleFactor:2 });
p.on("pageerror",e=>console.log("PAGEERR:",e.message));
await p.goto("http://localhost:8080/",{waitUntil:"networkidle"}); await new Promise(r=>setTimeout(r,3500));
const el = await p.$(".figure");
await el.screenshot({path:".screenshots/figure-closeup.png"});
console.log("figure closeup done");
await b.close();
