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
 * Failed capture — the monster breaks free. The link ring snaps and flies
 * OUTWARD (the opposite of the success contraction), with a desaturated
 * shockwave and NO bright white catch-core, so a failed throw reads distinctly
 * from a successful one (PV-11 success/fail distinction). Drive `progress` 0→1
 * over ~0.5s.
 * @param {object} k
 * @param {{x:number,y:number,color:number[],progress:number}} o
 */
export function drawCaptureFail(k, { x, y, color, progress }) {
  const p = Math.max(0, Math.min(1, progress));
  const fade = 1 - p;
  // Desaturated/darkened chain colour — a failed catch shouldn't look celebratory.
  const dim = [Math.round(color[0] * 0.5 + 40), Math.round(color[1] * 0.5 + 40), Math.round(color[2] * 0.5 + 40)];
  const dcol = k.rgb(dim[0], dim[1], dim[2]);
  // Outward shockwave ring (expands as it fades).
  k.drawCircle({ pos: k.vec2(x, y), radius: 6 + 28 * p, fill: false, outline: { width: 2.5 * fade + 0.5, color: dcol }, opacity: 0.5 * fade });
  // Link ring blown OUTWARD (expands instead of contracting) + spinning loose.
  drawLinkRing(k, x, y, dim, p * Math.PI * 3, RING_R * (1 + 1.6 * p), fade);
  // Snapped-link shards flinging out — the chain breaking apart.
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + p;
    const r0 = 8 + 30 * p, r1 = r0 + 9;
    k.drawLine({ p1: k.vec2(x + Math.cos(a) * r0, y + Math.sin(a) * r0), p2: k.vec2(x + Math.cos(a) * r1, y + Math.sin(a) * r1), width: 2 * fade + 0.4, color: dcol, opacity: 0.75 * fade });
  }
}

/**
 * Chain shatters on depletion — its last charge spent, the chain comes apart:
 * the links scatter sideways then FALL under gravity and fade, with a brief
 * desaturated flash. Distinct from drawCaptureFail's radial snap (this one drops
 * downward) so "out of charges" reads as the chain breaking, not a miss
 * (PV-11). Drive `progress` 0→1 over ~0.6s.
 * @param {object} k
 * @param {{x:number,y:number,color:number[],progress:number}} o
 */
export function drawChainBreak(k, { x, y, color, progress }) {
  const p = Math.max(0, Math.min(1, progress));
  const fade = 1 - p;
  const col = k.rgb(color[0], color[1], color[2]);
  // Brief flash at the break point.
  k.drawCircle({ pos: k.vec2(x, y), radius: 11 * fade, color: col, opacity: 0.3 * fade });
  // Broken links scatter sideways, then accelerate downward (gravity) and fade.
  for (let i = 0; i < LINKS; i++) {
    const a = (i / LINKS) * Math.PI * 2;
    const dx = Math.cos(a) * (10 + 26 * p);
    const dy = Math.sin(a) * 8 + 42 * p * p; // gravity: accelerating fall
    k.drawCircle({ pos: k.vec2(x + dx, y + dy), radius: 2.6 * fade + 0.6, color: col, opacity: 0.85 * fade });
    // a short tumbling segment trailing each falling fragment
    k.drawLine({ p1: k.vec2(x + dx, y + dy), p2: k.vec2(x + dx * 0.85, y + dy - 5), width: 1.6 * fade + 0.3, color: col, opacity: 0.5 * fade });
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
