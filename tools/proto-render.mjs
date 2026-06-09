// PROTOTYPE render: draw the AI-authored shape models from .screenshots/proto-shapes.json with
// src/systems/modelRender.js, at both large and icon sizes, to judge whether from-scratch shapes
// look good. Needs the vite dev server. Writes .screenshots/proto-models.png.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(".screenshots/proto-shapes.json", "utf8"));
const PORT = process.env.PORT || "5173";
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1180, height: 420 }, deviceScaleFactor: 2 });
p.on("pageerror", (e) => console.log("PAGEERR:", e.message));
await p.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
await new Promise((r) => setTimeout(r, 800));
const errs = await p.evaluate(async (creatures) => {
  const { drawAuthoredModel, FRAME } = await import("/src/systems/modelRender.js");
  const W = 1180, H = 420;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  cv.style.cssText = "position:fixed;left:0;top:0;z-index:99999"; document.body.appendChild(cv);
  const ctx = cv.getContext("2d"); ctx.fillStyle = "#0c0a14"; ctx.fillRect(0, 0, W, H); ctx.textAlign = "center";
  const errors = [];
  creatures.forEach((c, i) => {
    const x = i * 232 + 24, y = 30;
    // render the model to a 128 canvas
    const mc = document.createElement("canvas"); mc.width = FRAME; mc.height = FRAME;
    try { drawAuthoredModel(mc.getContext("2d"), { shapes: c.shapes }); }
    catch (e) { errors.push(c.name + ": " + e.message); }
    // large (192) + icon (40) to check it reads at both sizes
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(mc, x, y, 192, 192);
    ctx.strokeStyle = "#222"; ctx.strokeRect(x, y, 192, 192);
    ctx.drawImage(mc, x + 152, y + 200, 40, 40); // icon
    ctx.strokeStyle = "#333"; ctx.strokeRect(x + 152, y + 200, 40, 40);
    ctx.fillStyle = "#cfe8ff"; ctx.font = "15px sans-serif"; ctx.fillText(c.name, x + 96, y + 224);
    ctx.fillStyle = "#8a8aa8"; ctx.font = "12px sans-serif"; ctx.fillText(`${c.element}  ·  ${(c.shapes || []).length} shapes`, x + 96, y + 242);
  });
  return errors;
}, data);
await p.screenshot({ path: ".screenshots/proto-models.png", clip: { x: 0, y: 0, width: 1180, height: 420 } });
console.log(errs.length ? ("THROWS:\n" + errs.join("\n")) : "OK no throws");
await b.close();
