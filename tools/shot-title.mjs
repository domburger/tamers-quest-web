import { chromium } from "playwright";
const b = await chromium.launch({ headless:true, args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
async function cap(w,h,name){
  const p = await b.newPage({ viewport:{width:w,height:h}, deviceScaleFactor:1 });
  p.on("pageerror",e=>console.log("PAGEERR:",e.message));
  await p.goto("http://localhost:8080/",{waitUntil:"networkidle"}); await new Promise(r=>setTimeout(r,3500));
  await p.screenshot({path:`.screenshots/${name}.png`}); console.log("shot",name,`${w}x${h}`);
  await p.close();
}
await cap(1920,1080,"title-1080");
await cap(2560,1080,"title-ultrawide");
await cap(1440,900,"title-16x10");
await b.close();
