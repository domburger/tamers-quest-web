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
  // The 5 monsters the live pipeline persisted to PROD (distinct element + silhouette + rarity),
  // to confirm they read as a varied, brutal menagerie.
  const specs = [
    { typeName: "Cinderhorn", element: "Fire", size: 4, rarity: 3, model: { bodyShape: "brute", features: ["horns", "plates", "bone_spurs"], palette: { primary: "#3a2a24", secondary: "#7a3b1f", accent: "#ff6a00" } } },
    { typeName: "Trench Leviathan", element: "Water", size: 5, rarity: 4, model: { bodyShape: "leviathan", features: ["plates", "tail_spike", "extra_eyes"], palette: { primary: "#0b1b24", secondary: "#123447", accent: "#6bb7d6" } } },
    { typeName: "Mycobark Scorpid", element: "Nature", size: 3, rarity: 2, model: { bodyShape: "arthropod", features: ["plates", "tail_spike", "bone_spurs"], palette: { primary: "#4b3b2a", secondary: "#6a5a45", accent: "#b7c9a1" } } },
    { typeName: "Voltclaw Raptor", element: "Electric", size: 3, rarity: 3, model: { bodyShape: "raptor", features: ["wings", "spines", "extra_eyes"], palette: { primary: "#3b2f2a", secondary: "#6f7f8a", accent: "#ffd24a" } } },
    { typeName: "Vaultmaw Colossus", element: "Ice", size: 6, rarity: 5, model: { bodyShape: "brute", features: ["plates", "horns", "bone_spurs"], palette: { primary: "#8fb8d8", secondary: "#d9f1ff", accent: "#5a7ea6" } } },
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
