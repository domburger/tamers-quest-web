// Render every icon in src/ui/icons.js into a labelled grid (DOM canvas) and screenshot it — icon legibility check.
import { chromium } from "playwright";
const URL = process.env.GAME_URL || "http://localhost:5173";
const OUT = "C:/Users/domin/AppData/Local/Temp/claude/55a526f3ad7fb144/9162f8de-10a2-4c6b-9c8d-24e83f32f241/scratchpad/shots";
const b = await chromium.launch({ headless: true }); const p = await b.newPage({ viewport: { width: 900, height: 800 } });
await p.goto(URL + "/", { waitUntil: "networkidle" });
await p.evaluate(async () => {
  const m = await import("/src/ui/icons.js");
  const names = m.ICON_NAMES, cols = 8, cell = 112;
  const cv = document.createElement("canvas"); cv.width = cols * cell; cv.height = Math.ceil(names.length / cols) * cell;
  Object.assign(cv.style, { position: "fixed", left: "0", top: "0", zIndex: "999999", background: "#15110F" });
  document.body.appendChild(cv);
  const ctx = cv.getContext("2d"); ctx.fillStyle = "#15110F"; ctx.fillRect(0, 0, cv.width, cv.height);
  const rgba = (c, o) => `rgba(${c[0]},${c[1]},${c[2]},${o ?? 1})`;
  names.forEach((n, i) => {
    const x0 = (i % cols) * cell, y0 = Math.floor(i / cols) * cell;
    const kk = { vec2: (x, y) => ({ x, y }), rgb: (r, g, b2) => [r, g, b2],
      drawLine: ({ p1, p2, width, color, opacity }) => { ctx.strokeStyle = rgba(color, opacity); ctx.lineWidth = width; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); },
      drawCircle: ({ pos, radius, color, opacity, fill, outline }) => { ctx.beginPath(); ctx.arc(pos.x, pos.y, radius, 0, 7); if (fill !== false) { ctx.fillStyle = rgba(color, opacity); ctx.fill(); } if (outline) { ctx.strokeStyle = rgba(color, opacity); ctx.lineWidth = outline.width; ctx.stroke(); } },
      drawRect: ({ pos, width, height, color, opacity, fill, outline }) => { if (fill !== false) { ctx.fillStyle = rgba(color, opacity); ctx.fillRect(pos.x, pos.y, width, height); } if (outline) { ctx.strokeStyle = rgba(color, opacity); ctx.lineWidth = outline.width; ctx.strokeRect(pos.x, pos.y, width, height); } },
      drawPolygon: ({ pts, color, opacity }) => { ctx.fillStyle = rgba(color, opacity); ctx.beginPath(); pts.forEach((q, j) => (j ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.fill(); } };
    m.drawIcon(kk, n, { x: x0 + 34, y: y0 + 42, size: 40, color: [245, 239, 233] });
    m.drawIcon(kk, n, { x: x0 + 86, y: y0 + 42, size: 18, color: [240, 83, 61] });
    ctx.fillStyle = "#A3968C"; ctx.font = "12px sans-serif"; ctx.textAlign = "center"; ctx.fillText(n, x0 + cell / 2, y0 + 92);
  });
});
await p.screenshot({ path: `${OUT}/icons.png`, fullPage: false }); console.log("shot icons");
await b.close();
