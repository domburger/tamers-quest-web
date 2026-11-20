// Procedural Spirit Chain visuals — pure Kaboom-primitive draws (mirrors
// render/character.js). No sprites, no particle system: a ring of chain "links"
// + connecting segments + a portal-style pulse glow, tier-tinted. Called from a
// scene's onDraw. Coordinates are world-space (the camera transform applies).

const LINKS = 6;
const RING_R = 9; // base radius of the link ring

// Resolve a chain definition's tint to an [r,g,b] array, with a neutral default.
export function chainColor(def) {
  return (def && def.color) || [70, 230, 198]; // PAL.teal — an untinted chain still reads as spirit-light
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
  // links — a soft bloom halo under each, then the crisp link, so the ring glows.
  for (const p of pts) {
    k.drawCircle({ pos: p, radius: 4.2, color: col, opacity: 0.16 * opacity });
  }
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
 * A loot chest sitting against a wall: a small wooden box with a lid band, metal
 * clasp, and a soft pulsing glow hinting it holds a spirit chain.
 * @param {object} k
 * @param {{x:number,y:number,t:number}} o
 */
export function drawChest(k, { x, y, t }) {
  const pulse = 0.6 + 0.4 * Math.sin(t * 3);
  // Ground contact shadow + a pulsing TEAL spirit-glow — the chain inside leaks its
  // light, so the loot reads as enticing AND on-brand (vs a warm-wood box that
  // clashed with the bioluminescent world).
  k.drawEllipse({ pos: k.vec2(x, y + 11), radiusX: 15, radiusY: 4, color: k.rgb(0, 0, 0), opacity: 0.3 });
  k.drawCircle({ pos: k.vec2(x, y - 2), radius: 18 * pulse, color: k.rgb(70, 230, 198), opacity: 0.18 }); // PAL.teal
  // Dark dusky-wood body (sits in the dark world) with a darker lower edge for depth.
  k.drawRect({ pos: k.vec2(x, y + 2), width: 22, height: 15, anchor: "center", radius: 2, color: k.rgb(56, 44, 42) });
  k.drawRect({ pos: k.vec2(x, y + 7), width: 22, height: 5, anchor: "center", radius: 2, color: k.rgb(38, 29, 30) });
  // Lid + a top highlight bevel.
  k.drawRect({ pos: k.vec2(x, y - 6), width: 24, height: 8, anchor: "center", radius: 2, color: k.rgb(74, 58, 54) });
  k.drawRect({ pos: k.vec2(x, y - 8), width: 21, height: 2.5, anchor: "center", radius: 1, color: k.rgb(110, 90, 80) });
  // Amber corner bands down the sides (PAL.amber treasure metal).
  for (const sx of [-9.5, 9.5]) k.drawRect({ pos: k.vec2(x + sx, y + 3), width: 3, height: 13, anchor: "center", color: k.rgb(224, 168, 92) });
  // Amber band across the seam + clasp, with teal spirit-light glinting through.
  k.drawRect({ pos: k.vec2(x, y - 2), width: 24, height: 3, anchor: "center", color: k.rgb(232, 184, 110) });
  k.drawRect({ pos: k.vec2(x, y - 1), width: 5, height: 6, anchor: "center", radius: 1, color: k.rgb(240, 200, 128) });
  k.drawCircle({ pos: k.vec2(x + 1, y - 1.5), radius: 1.3, color: k.rgb(180, 255, 238), opacity: 0.6 + 0.4 * pulse });
}

