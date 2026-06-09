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
  const specs = [
    { typeName: "Hornbrute", element: "earth", model: { bodyShape: "brute", features: ["horns", "tusks", "plates"], palette: { primary: "rust", accent: "amber" } } },
    { typeName: "Spineraptor", element: "air", model: { bodyShape: "raptor", features: ["wings", "spines"], palette: { primary: "slate", accent: "cyan" } } },
    { typeName: "Crystalsaur", element: "ice", model: { bodyShape: "saurian", features: ["crystals", "plates", "tail_spike"], palette: { primary: "#3a6ea5", accent: "#bfe6ff" } } },
    { typeName: "Manebeast", element: "fire", model: { bodyShape: "beast", features: ["mane", "horns"], palette: { primary: "blood", accent: "ember" } } },
    { typeName: "Stingerbug", element: "poison", model: { bodyShape: "arthropod", features: ["tail_spike", "extra_eyes", "plates"], palette: { primary: "venom", accent: "lime" } } },
    { typeName: "Bonelev", element: "dark", model: { bodyShape: "leviathan", features: ["bone_spurs", "spines"], palette: { primary: "obsidian", accent: "violet" } } },
    { typeName: "NoModelFire", element: "fire" }, // control: element default, no model
    { typeName: "Wingmaw", element: "celestial", model: { bodyShape: "leviathan", features: ["wings", "tusks"] } }, // empty palette → element default
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
