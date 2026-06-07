// Procedural Spirit Chain visuals — pure Kaboom-primitive draws (mirrors
// render/character.js). No sprites, no particle system: a ring of chain "links"
// + connecting segments + a portal-style pulse glow, tier-tinted. Called from a
// scene's onDraw. Coordinates are world-space (the camera transform applies).

const LINKS = 6;
const RING_R = 9; // base radius of the link ring

// Resolve a chain definition's tint to an [r,g,b] array, with a neutral default.
export function chainColor(def) {
  return (def && def.color) || [180, 180, 190];
}

// Draw the link ring (shared by the static model and the projectile). `angle`
// spins the ring; `radius` lets the capture animation contract it inward.
function drawLinkRing(k, x, y, color, angle, radius, opacity = 1) {
  const col = k.rgb(color[0], color[1], color[2]);
  const pts = [];
  for (let i = 0; i < LINKS; i++) {
    const a = angle + (i / LINKS) * Math.PI * 2;
    pts.push(k.vec2(x + Math.cos(a) * radius, y + Math.sin(a) * radius));
  }
  // connecting segments
  for (let i = 0; i < LINKS; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % LINKS];
    k.drawLine({ p1, p2, width: 2, color: col, opacity: 0.7 * opacity });
  }
  // links
  for (const p of pts) {
    k.drawCircle({ pos: p, radius: 2.4, color: col, opacity });
  }
}

/**
 * Static / inventory icon and the head of an in-flight chain.
 * @param {object} k Kaboom context
 * @param {{x:number,y:number,color:number[],t:number,scale?:number}} o
 */
export function drawSpiritChainModel(k, { x, y, color, t, scale = 1 }) {
  const pulse = 0.6 + 0.4 * Math.sin(t * 4); // shared portal-glow cadence
  k.drawCircle({ pos: k.vec2(x, y), radius: RING_R * scale * 1.4 * pulse, color: k.rgb(color[0], color[1], color[2]), opacity: 0.22 });
  drawLinkRing(k, x, y, color, t * 1.5, RING_R * scale);
}

/**
 * In-flight thrown chain: spinning link ring + a short fading motion trail along
 * the reverse of its velocity. Purely cosmetic; collision uses proj.x/proj.y.
 * @param {object} k
 * @param {{x:number,y:number,vx:number,vy:number}} proj
 * @param {number[]} color
 * @param {number} t  animation clock (k.time())
 */
export function drawSpiritChainProjectile(k, proj, color, t) {
  const col = k.rgb(color[0], color[1], color[2]);
  const sp = Math.hypot(proj.vx, proj.vy) || 1;
  const nx = proj.vx / sp, ny = proj.vy / sp;
  // Glowing, tapering motion trail behind the head (PV-T11 juice — the throw is the
  // signature verb): a longer comet tail + a soft glow halo around the spinning head.
  for (let i = 1; i <= 6; i++) {
    const r = 6 - i * 0.8;
    if (r <= 0.5) break;
    k.drawCircle({ pos: k.vec2(proj.x - nx * i * 6, proj.y - ny * i * 6), radius: r, color: col, opacity: 0.34 - i * 0.05 });
  }
  k.drawCircle({ pos: k.vec2(proj.x, proj.y), radius: 12, color: col, opacity: 0.16 }); // soft glow halo
  drawSpiritChainModel(k, { x: proj.x, y: proj.y, color, t: t * 4, scale: 0.85 });
}

/**
 * Landing impact for a thrown chain (miss/drop or wall): an expanding fading ring
 * + a short spark burst. Drive `progress` 0→1 over ~0.3s. Tier-tinted; gives a
 * thrown chain weight and makes a miss readable instead of silently vanishing.
 * @param {object} k
 * @param {{x:number,y:number,color:number[],progress:number}} o
 */
export function drawChainImpact(k, { x, y, color, progress }) {
  const p = Math.max(0, Math.min(1, progress));
  const col = k.rgb(color[0], color[1], color[2]);
  const fade = 1 - p;
  // expanding ring
  k.drawCircle({ pos: k.vec2(x, y), radius: 5 + 20 * p, fill: false, outline: { width: 2.5 * fade + 0.5, color: col }, opacity: 0.55 * fade });
  // quick spark burst
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r0 = 4 + 12 * p, r1 = r0 + 7 * fade;
    k.drawLine({ p1: k.vec2(x + Math.cos(a) * r0, y + Math.sin(a) * r0), p2: k.vec2(x + Math.cos(a) * r1, y + Math.sin(a) * r1), width: 2 * fade + 0.5, color: col, opacity: 0.7 * fade });
  }
}

/**
 * A loot chest sitting against a wall: a small wooden box with a lid band, metal
 * clasp, and a soft pulsing glow hinting it holds a spirit chain.
 * @param {object} k
 * @param {{x:number,y:number,t:number}} o
 */
export function drawChest(k, { x, y, t }) {
  const pulse = 0.6 + 0.4 * Math.sin(t * 3);
  // Ground contact shadow + a pulsing treasure glow so loot reads as enticing.
  k.drawEllipse({ pos: k.vec2(x, y + 11), radiusX: 15, radiusY: 4, color: k.rgb(0, 0, 0), opacity: 0.3 });
  k.drawCircle({ pos: k.vec2(x, y - 2), radius: 18 * pulse, color: k.rgb(245, 197, 59), opacity: 0.16 });
  // Body with a darker lower edge for depth.
  k.drawRect({ pos: k.vec2(x, y + 2), width: 22, height: 15, anchor: "center", radius: 2, color: k.rgb(126, 86, 52) });
  k.drawRect({ pos: k.vec2(x, y + 7), width: 22, height: 5, anchor: "center", radius: 2, color: k.rgb(92, 61, 36) });
  // Lid + a top highlight bevel.
  k.drawRect({ pos: k.vec2(x, y - 6), width: 24, height: 8, anchor: "center", radius: 2, color: k.rgb(150, 104, 64) });
  k.drawRect({ pos: k.vec2(x, y - 8), width: 21, height: 2.5, anchor: "center", radius: 1, color: k.rgb(182, 134, 90) });
  // Gold corner bands down the sides.
  for (const sx of [-9.5, 9.5]) k.drawRect({ pos: k.vec2(x + sx, y + 3), width: 3, height: 13, anchor: "center", color: k.rgb(168, 140, 80) });
  // Metal band across the seam + clasp + a glinting highlight.
  k.drawRect({ pos: k.vec2(x, y - 2), width: 24, height: 3, anchor: "center", color: k.rgb(196, 170, 96) });
  k.drawRect({ pos: k.vec2(x, y - 1), width: 5, height: 6, anchor: "center", radius: 1, color: k.rgb(228, 206, 128) });
  k.drawCircle({ pos: k.vec2(x + 1, y - 1.5), radius: 1.1, color: k.rgb(255, 248, 210), opacity: 0.6 + 0.4 * pulse });
}

/**
 * Capture flash: links contract inward while a bright core swells and a ghost of
 * the captured monster shrinks. Drive `progress` 0→1 over ~0.6s.
 * @param {object} k
 * @param {{x:number,y:number,color:number[],progress:number}} o
 */
export function drawCaptureAnimation(k, { x, y, color, progress }) {
  const p = Math.max(0, Math.min(1, progress));
  const col = k.rgb(color[0], color[1], color[2]);
  // ghost of the monster shrinking in
  k.drawCircle({ pos: k.vec2(x, y), radius: 22 * (1 - p), color: col, opacity: 0.25 * (1 - p) });
  // bright core swelling
  k.drawCircle({ pos: k.vec2(x, y), radius: 4 + 8 * p, color: k.rgb(255, 255, 255), opacity: 0.4 + 0.5 * p });
  // links contracting toward the center
  drawLinkRing(k, x, y, color, p * Math.PI * 4, RING_R * (1 - 0.7 * p));
  // Celebratory spark burst on the finish — punctuates a successful "caught!".
  if (p > 0.6) {
    const q = (p - 0.6) / 0.4; // 0→1 across the finish
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + p * 2;
      const r = 6 + q * 26;
      k.drawCircle({ pos: k.vec2(x + Math.cos(a) * r, y + Math.sin(a) * r), radius: 2 * (1 - q) + 0.6, color: col, opacity: 0.85 * (1 - q) });
    }
  }
}
