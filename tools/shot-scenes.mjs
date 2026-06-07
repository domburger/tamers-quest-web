import { chromium } from "playwright";
const b = await chromium.launch({ headless:true, args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport:{width:1280,height:720}, deviceScaleFactor:2 });
p.on("pageerror",e=>console.log("PAGEERR:",e.message));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await p.goto("http://localhost:8080/",{waitUntil:"networkidle"}); await sleep(4000);
await p.keyboard.press("Enter"); await sleep(1500);          // -> characterSelect
await p.screenshot({path:".screenshots/scene-charselect.png"}); console.log("charselect");
await p.mouse.click(640, 720-80); await sleep(1000);         // + New Character
await p.keyboard.type("Scout",{delay:60}); await sleep(400);
await p.keyboard.press("Enter"); await sleep(1500);
await p.mouse.click(640,130); await sleep(2000);             // first slot -> lobby
await p.screenshot({path:".screenshots/scene-lobby.png"}); console.log("lobby");
// lobby buttons: Start Run, Inventory, Spirit Shop, Base Upgrades, Bestiary, Cosmetics, Settings, Back
// startY=128+22=150, btnH=44, gap=10 => step 54. Inventory i=1 -> y=204
await p.mouse.click(640, 204); await sleep(1500);
await p.screenshot({path:".screenshots/scene-inventory.png"}); console.log("inventory");
await p.keyboard.press("Escape"); await sleep(800);
// back to lobby; Spirit Shop i=2 -> y=258
await p.mouse.click(640, 258); await sleep(1500);
await p.screenshot({path:".screenshots/scene-shop.png"}); console.log("shop");
await p.keyboard.press("Escape"); await sleep(800);
// Base Upgrades i=3 -> y=312
await p.mouse.click(640, 312); await sleep(1500);
await p.screenshot({path:".screenshots/scene-baseupgrades.png"}); console.log("baseupgrades");
await b.close();
