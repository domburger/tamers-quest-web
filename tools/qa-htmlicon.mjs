// Rasterize live monster html models the way htmlIconRaster does (sanitize -> SVG foreignObject -> canvas) next
// to the same markup mounted as live DOM, to compare what the icon path loses. TYPES_JSON = path to
// /api/monstertypes output; NAMES = comma list (default: first 4 html monsters).
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const URL = process.env.GAME_URL || "http://localhost:5173";
const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/shots";
const all = JSON.parse(readFileSync(process.env.TYPES_JSON, "utf8"));
const arr = (Array.isArray(all) ? all : Object.values(all)).filter((t) => t.html);
const names = (process.env.NAMES || "").split(",").filter(Boolean);
const pick = names.length ? arr.filter((t) => names.some((n) => (t.typeName || "").includes(n))) : arr.slice(0, 4);
const b = await chromium.launch({ headless: true }); const p = await b.newPage({ viewport: { width: 1100, height: 600 } });
p.on("pageerror", (e) => console.log("PAGEERR:", e.message.split("\n")[0]));
await p.goto(URL + "/", { waitUntil: "networkidle" });
if (process.env.RAW) await p.evaluate(() => { window.__RAW = true; });
const res = await p.evaluate(async (types) => {
  const { sanitizeHtmlModel } = await import("/src/systems/htmlSanitize.js");
  const wrap = document.createElement("div"); Object.assign(wrap.style, { position: "fixed", left: "0", top: "0", zIndex: 99999, background: "#15110F", display: "flex", flexWrap: "wrap", gap: "8px", padding: "8px" });
  document.body.appendChild(wrap);
  const out = [];
  for (const t of types) {
    const m = sanitizeHtmlModel(t.html); const box = (m && m.canvas) || 256;
    if (window.__RAW) { const raw = document.createElement("div"); raw.style.cssText = `width:${box}px;height:${box}px;background:#20302a;`; raw.innerHTML = t.html.base || ""; wrap.appendChild(raw); } // UNSANITIZED (local QA only)
    const live = document.createElement("div"); live.style.cssText = `width:${box}px;height:${box}px;background:#2a2320;`; live.innerHTML = m ? m.base : ""; wrap.appendChild(live);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${box}px;height:${box}px">${m ? m.base.replace(/<svg(?=[\s>])/g, '<svg xmlns="http://www.w3.org/2000/svg"') : ""}</div></foreignObject></svg>`;
    const cv = document.createElement("canvas"); cv.width = box; cv.height = box; cv.style.background = "#3a2f2a"; wrap.appendChild(cv);
    const ok = await new Promise((res) => { const img = new Image(); img.onload = () => { cv.getContext("2d").drawImage(img, 0, 0, box, box); res(true); }; img.onerror = () => res(false); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
    out.push(`${t.typeName}: raster ${ok ? "loaded" : "FAILED"}, sanitized ${m ? m.base.length : 0} chars of ${String(t.html.base || "").length}`);
  }
  return out;
}, pick);
console.log(res.join("\n"));
await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/htmlicon.png` }); console.log("shot htmlicon (pairs: live DOM | icon raster)");
await b.close();
