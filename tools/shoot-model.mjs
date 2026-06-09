// Visual smoke for the builder→renderer loop: render synthetic monsters carrying a generated
// `model` (bodyShape + palette + features) so the new model-consumption in spritegen.js can be
// eyeballed. Needs the vite dev server on :5173. Writes .screenshots/model-monsters.png.
import { chromium } from "playwright";
const b = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 2 });
p.on("pageerror", e => console.log("PAGEERR:", e.message));
await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await new Promise(r => setTimeout(r, 1200));
const errs = await p.evaluate(async () => {
  const sg = await import('/src/systems/spritegen.js');
  const errors = [];
  const base = { baseStrength: 80, baseDefense: 70, baseSpeed: 70, size: 4, rarity: 4, description: "" };
  // The 5 monsters the live pipeline actually generated (distinct element themes), to confirm
  // their exotic palette words resolve and they read as a varied, brutal menagerie.
  const specs = [
    { typeName: "Mawforge Alpha", element: "Fire", size: 5, model: { bodyShape: "brute", features: ["tusks", "spines", "bone_spurs"], palette: { primary: "basalt", secondary: "ember", accent: "magma" } } },
    { typeName: "Abyss Maw", element: "Water", size: 6, model: { bodyShape: "leviathan", features: ["extra_eyes", "plates", "tail_spike"], palette: { primary: "midnight blue", secondary: "slate", accent: "teal" } } },
    { typeName: "Mosshorn Brute", element: "Nature", size: 4, model: { bodyShape: "beast", features: ["horns", "mane", "bone_spurs"], palette: { primary: "moss green", secondary: "bark brown", accent: "lichen gold" } } },
    { typeName: "Tempest Talon", element: "Electric", size: 3, model: { bodyShape: "raptor", features: ["wings", "extra_eyes", "bone_spurs"], palette: { primary: "charcoal", secondary: "storm gray", accent: "electric blue" } } },
    { typeName: "Rimefang Brute", element: "Ice", size: 4, model: { bodyShape: "beast", features: ["horns", "tusks", "mane"], palette: { primary: "ash", secondary: "frost", accent: "iceblue" } } },
    { typeName: "NoModel Fire", element: "Fire" }, // control: element default, no model
  ];
  const cv = document.createElement('canvas'); cv.width = 1100; cv.height = 720; cv.style.cssText = 'position:fixed;left:0;top:0;z-index:99999'; document.body.appendChild(cv);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#0c0a14'; ctx.fillRect(0, 0, 1100, 720); ctx.textAlign = 'center';
  specs.forEach((t, i) => {
    const c = i % 4, r = Math.floor(i / 4); const x = c * 270 + 135, y = r * 330 + 150;
    try { const sp = sg.generateMonsterSprite({ ...base, ...t }); ctx.drawImage(sp, x - 96, y - 96, 192, 192); }
    catch (e) { errors.push(t.typeName + ": " + e.message); ctx.fillStyle = '#f55'; ctx.font = '16px sans-serif'; ctx.fillText('ERR ' + e.message, x, y); }
    ctx.fillStyle = '#cfe8ff'; ctx.font = '15px sans-serif'; ctx.fillText(t.typeName, x, y + 110);
    ctx.fillStyle = '#8a8aa8'; ctx.font = '12px sans-serif'; ctx.fillText((t.model ? t.model.features.join(',') : 'no model'), x, y + 128);
  });
  return errors;
});
await p.screenshot({ path: ".screenshots/model-monsters.png", clip: { x: 0, y: 0, width: 1100, height: 720 } });
console.log(errs.length ? ("THROWS:\n" + errs.join("\n")) : "OK no throws");
await b.close();
