import { chromium } from "playwright";
const b = await chromium.launch({ headless:true, args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport:{width:1280,height:720}, deviceScaleFactor:2 });
p.on("pageerror",e=>console.log("PAGEERR:",e.message));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await p.goto((process.env.GAME_URL||"http://localhost:8080")+"/",{waitUntil:"networkidle"}); await sleep(4000);
await p.keyboard.press("Enter"); await sleep(1500);          // -> characterSelect
await p.screenshot({path:".screenshots/scene-charselect.png"}); console.log("charselect");
await p.mouse.click(640, 720-80); await sleep(1000);         // + New Character
await p.screenshot({path:".screenshots/scene-nameinput.png"}); console.log("nameinput (PT1-T03 DOM input)");
await p.keyboard.type("Scout",{delay:60}); await sleep(400);
await p.keyboard.press("Enter"); await sleep(1500);
await p.mouse.click(640,130); await sleep(2000);             // first slot -> lobby
await p.screenshot({path:".screenshots/scene-lobby.png"}); console.log("lobby");
// lobby buttons: Start Run, Inventory, Spirit Shop, Base Upgrades, Bestiary, Cosmetics, Settings, Back
// startY=128+22=150, btnH=44, gap=10 => step 54. Inventory i=1 -> y=204
await p.mouse.click(640, 204); await sleep(1500);
await p.screenshot({path:".screenshots/scene-inventory.png"}); console.log("inventory (monsters tab)");
// Spirit Chains tab (PV-A1 chrome check: equip/upgrade CTAs, row, essence). 2nd tab center ≈ (725,95).
await p.mouse.click(725, 95); await sleep(1200);
await p.screenshot({path:".screenshots/scene-inventory-chains.png"}); console.log("inventory (chains tab)");
await p.keyboard.press("Escape"); await sleep(800);
// back to lobby; Spirit Shop i=2 -> y=258
await p.mouse.click(640, 258); await sleep(1500);
await p.screenshot({path:".screenshots/scene-shop.png"}); console.log("shop");
await p.keyboard.press("Escape"); await sleep(800);
// Base Upgrades i=3 -> y=312
await p.mouse.click(640, 312); await sleep(1500);
await p.screenshot({path:".screenshots/scene-baseupgrades.png"}); console.log("baseupgrades");
await p.keyboard.press("Escape"); await sleep(800);          // baseUpgrades -> lobby (VS-15 Esc)
// Cosmetics i=5 -> y=150+5*54=420
await p.mouse.click(640, 420); await sleep(1500);
await p.screenshot({path:".screenshots/scene-cosmetics.png"}); console.log("cosmetics");
await p.keyboard.press("Escape"); await sleep(800);          // cosmetics -> lobby (Esc)
// Settings i=6 -> y=150+6*54=474
await p.mouse.click(640, 474); await sleep(1500);
await p.screenshot({path:".screenshots/scene-settings.png"}); console.log("settings");
await b.close();
