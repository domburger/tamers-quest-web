import { chromium } from "playwright";
const b = await chromium.launch({ headless:true, args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport:{width:1280,height:720}, deviceScaleFactor:2 });
p.on("pageerror",e=>console.log("PAGEERR:",e.message));
p.on("console",m=>{const t=m.text(); if(/error|cannot|undefined/i.test(t)) console.log("CON:",t);});
await p.goto("http://localhost:8080/",{waitUntil:"networkidle"}); await new Promise(r=>setTimeout(r,4000));
await p.click('#title [data-go="cosmetics"]'); await new Promise(r=>setTimeout(r,2500));
await p.screenshot({path:".screenshots/cosmetics.png"}); console.log("cosmetics shot");
await b.close();
