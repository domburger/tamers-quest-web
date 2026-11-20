const LINKS = 6;
const RING_R = 9;

export function chainColor(def) {
  return (def && def.color) || [70, 230, 198];
}

function drawLinkRing(k, x, y, color, angle, radius, opacity = 1) {
  const col = k.rgb(color[0], color[1], color[2]);
  const pts = [];
  for (let i = 0; i < LINKS; i++) {
    const a = angle + (i / LINKS) * Math.PI * 2;
    pts.push(k.vec2(x + Math.cos(a) * radius, y + Math.sin(a) * radius));
  }
  for (let i = 0; i < LINKS; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % LINKS];
    k.drawLine({ p1, p2, width: 2, color: col, opacity: 0.7 * opacity });
  }
  for (const p of pts) {
    k.drawCircle({ pos: p, radius: 4.2, color: col, opacity: 0.16 * opacity });
  }
  for (const p of pts) {
    k.drawCircle({ pos: p, radius: 2.4, color: col, opacity });
  }
}

export function drawSpiritChainModel(k, { x, y, color, t, scale = 1 }) {
  const pulse = 0.6 + 0.4 * Math.sin(t * 4);
  k.drawCircle({ pos: k.vec2(x, y), radius: RING_R * scale * 1.4 * pulse, color: k.rgb(color[0], color[1], color[2]), opacity: 0.22 });
  drawLinkRing(k, x, y, color, t * 1.5, RING_R * scale);
}

export function drawSpiritChainProjectile(k, proj, color, t) {
  const col = k.rgb(color[0], color[1], color[2]);
  const sp = Math.hypot(proj.vx, proj.vy) || 1;
  const nx = proj.vx / sp, ny = proj.vy / sp;
  for (let i = 1; i <= 6; i++) {
    const r = 6 - i * 0.8;
    if (r <= 0.5) break;
    k.drawCircle({ pos: k.vec2(proj.x - nx * i * 6, proj.y - ny * i * 6), radius: r, color: col, opacity: 0.34 - i * 0.05 });
  }
  k.drawCircle({ pos: k.vec2(proj.x, proj.y), radius: 12, color: col, opacity: 0.16 });
  drawSpiritChainModel(k, { x: proj.x, y: proj.y, color, t: t * 4, scale: 0.85 });
}

export function drawChest(k, { x, y, t }) {
  const pulse = 0.6 + 0.4 * Math.sin(t * 3);
  k.drawEllipse({ pos: k.vec2(x, y + 11), radiusX: 15, radiusY: 4, color: k.rgb(0, 0, 0), opacity: 0.3 });
  k.drawCircle({ pos: k.vec2(x, y - 2), radius: 18 * pulse, color: k.rgb(70, 230, 198), opacity: 0.18 });
  k.drawRect({ pos: k.vec2(x, y + 2), width: 22, height: 15, anchor: "center", radius: 2, color: k.rgb(56, 44, 42) });
  k.drawRect({ pos: k.vec2(x, y + 7), width: 22, height: 5, anchor: "center", radius: 2, color: k.rgb(38, 29, 30) });
  k.drawRect({ pos: k.vec2(x, y - 6), width: 24, height: 8, anchor: "center", radius: 2, color: k.rgb(74, 58, 54) });
  k.drawRect({ pos: k.vec2(x, y - 8), width: 21, height: 2.5, anchor: "center", radius: 1, color: k.rgb(110, 90, 80) });
  for (const sx of [-9.5, 9.5]) k.drawRect({ pos: k.vec2(x + sx, y + 3), width: 3, height: 13, anchor: "center", color: k.rgb(224, 168, 92) });
  k.drawRect({ pos: k.vec2(x, y - 2), width: 24, height: 3, anchor: "center", color: k.rgb(232, 184, 110) });
  k.drawRect({ pos: k.vec2(x, y - 1), width: 5, height: 6, anchor: "center", radius: 1, color: k.rgb(240, 200, 128) });
  k.drawCircle({ pos: k.vec2(x + 1, y - 1.5), radius: 1.3, color: k.rgb(180, 255, 238), opacity: 0.6 + 0.4 * pulse });
}

