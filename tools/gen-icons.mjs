import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
let svg = readFileSync("public/icon.svg", "utf8")
  .replace(/width="512"/, 'width="100%"').replace(/height="512"/, 'height="100%"');
const b = await chromium.launch({ headless:true, args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--force-color-profile=srgb"] });
async function render(size, out){
  const p = await b.newPage({ viewport:{width:size,height:size}, deviceScaleFactor:1 });
  await p.setContent(`<!doctype html><meta charset=utf8><style>*{margin:0}html,body{width:100%;height:100%;background:#050506}svg{display:block;width:100%;height:100%}</style>${svg}`, {waitUntil:"networkidle"});
  await new Promise(r=>setTimeout(r,250));
  writeFileSync(out, await p.screenshot({ type:"png" }));
  console.log("wrote", out, size+"x"+size); await p.close();
}
await render(512, "public/icon-512.png");
await render(192, "public/icon-192.png");
await render(180, "public/apple-touch-icon.png");
await b.close();
