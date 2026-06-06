// Procedural sprite generation — replaces the PNG asset pipeline with
// deterministic canvas art driven by game data. Every generator returns an
// HTMLCanvasElement, which Kaboom's loadSprite() accepts directly.

import { makeRng as rngFor } from "../engine/rng.js";

// ─── Color helpers ───
function rgb(c) {
  return `rgb(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0})`;
}
function rgba(c, a) {
  return `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`;
}
function shade(c, amt) {
  // amt < 0 darkens, > 0 lightens
  return [
    Math.max(0, Math.min(255, c[0] + 255 * amt)),
    Math.max(0, Math.min(255, c[1] + 255 * amt)),
    Math.max(0, Math.min(255, c[2] + 255 * amt)),
  ];
}

const ELEMENT_PALETTES = {
  fire:      { base: [222, 74, 40],   accent: [255, 184, 66],  dark: [120, 32, 22] },
  water:     { base: [52, 122, 220],  accent: [138, 206, 255], dark: [24, 60, 132] },
  nature:    { base: [72, 168, 84],   accent: [176, 230, 116], dark: [34, 90, 46] },
  light:     { base: [240, 220, 122], accent: [255, 250, 224], dark: [186, 152, 58] },
  dark:      { base: [112, 72, 152],  accent: [184, 134, 222], dark: [46, 28, 70] },
  neutral:   { base: [150, 150, 162], accent: [212, 212, 224], dark: [78, 78, 92] },
  // Expanded set so every element reads distinctly (was all-gray before).
  air:       { base: [120, 195, 225], accent: [205, 238, 248], dark: [58, 118, 150] },
  ice:       { base: [142, 208, 236], accent: [220, 246, 255], dark: [62, 124, 160] },
  earth:     { base: [176, 128, 72],  accent: [224, 190, 132], dark: [94, 64, 34] },
  electric:  { base: [242, 206, 70],  accent: [255, 242, 160], dark: [150, 112, 18] },
  poison:    { base: [172, 92, 192],  accent: [222, 154, 236], dark: [86, 38, 104] },
  arcane:    { base: [142, 92, 212],  accent: [202, 152, 246], dark: [60, 34, 112] },
  celestial: { base: [184, 198, 238], accent: [228, 234, 252], dark: [104, 120, 168] },
  chaos:     { base: [202, 72, 112],  accent: [242, 142, 172], dark: [110, 30, 56] },
  metal:     { base: [152, 166, 186], accent: [212, 222, 236], dark: [82, 94, 112] },
};

// Map every element name in the data (incl. dual types & synonyms) to a palette.
const ELEMENT_ALIASES = {
  wind: "air",
  holy: "light",
  darkness: "dark", shadow: "dark", void: "dark", ghost: "celestial",
  ethereal: "celestial", lunar: "celestial", cosmic: "arcane",
  mercury: "metal",
};

function paletteFor(element) {
  const primary = String(element || "").toLowerCase().split("/")[0].trim();
  const key = ELEMENT_ALIASES[primary] || primary;
  return ELEMENT_PALETTES[key] || ELEMENT_PALETTES.neutral;
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// Canonical element key (folds dual-types & synonyms), shared with paletteFor.
function canonicalElement(element) {
  const primary = String(element || "").toLowerCase().split("/")[0].trim();
  return ELEMENT_ALIASES[primary] || primary;
}

// Trace a closed creature silhouette: a radial blob with optional lobes (bumpy/
// spiky), a phase offset, and an upper taper (egg/crystal). Element-driven so
// monsters don't all read as the same oval.
function traceBlob(ctx, cx, cy, rx, ry, s = {}) {
  const { lobes = 0, amp = 0, phase = 0, topTaper = 0 } = s;
  const steps = 72;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const rr = lobes ? 1 + amp * Math.sin(lobes * t + phase) : 1;
    const taper = 1 - topTaper * Math.max(0, -Math.sin(t)); // pull the top inward
    const x = cx + Math.cos(t) * rx * rr * taper;
    const y = cy + Math.sin(t) * ry * rr;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

// Silhouette params per element — spiky for fire/chaos, bumpy for earth/metal,
// tapered for ice/celestial, squat for water, etc. Unknown elements pick a
// stable generic shape so the bestiary still looks varied.
function shapeFor(ckey, rng) {
  const phase = rng.float(0, Math.PI * 2);
  switch (ckey) {
    case "fire":      return { lobes: rng.int(6, 9), amp: rng.float(0.10, 0.16), phase };
    case "chaos":     return { lobes: rng.int(5, 9), amp: rng.float(0.13, 0.21), phase };
    case "dark":      return { lobes: rng.int(5, 7), amp: rng.float(0.08, 0.13), phase };
    case "earth":     return { lobes: rng.int(5, 7), amp: rng.float(0.11, 0.17), phase, sy: 0.92 };
    case "metal":     return { lobes: rng.int(6, 8), amp: rng.float(0.06, 0.10), phase };
    case "nature":    return { lobes: rng.int(4, 6), amp: rng.float(0.07, 0.12), phase };
    case "poison":    return { lobes: rng.int(5, 7), amp: rng.float(0.08, 0.14), phase };
    case "water":     return { sx: 1.12, sy: 0.9 };
    case "ice":       return { topTaper: rng.float(0.30, 0.44), sy: 1.06 };
    case "celestial": return { topTaper: rng.float(0.20, 0.34), sy: 1.05 };
    case "light":     return { topTaper: rng.float(0.16, 0.30) };
    case "arcane":    return { lobes: rng.int(4, 6), amp: rng.float(0.05, 0.10), phase, topTaper: 0.18 };
    case "air":       return { sy: 0.95 };
    default: {
      const opts = [
        { lobes: rng.int(5, 7), amp: rng.float(0.07, 0.13), phase },
        { topTaper: rng.float(0.18, 0.32) },
        { sx: 1.1, sy: 0.9 },
        {},
      ];
      return opts[rng.int(0, opts.length - 1)];
    }
  }
}

// ─── Monster sprites ───
// A blobby creature whose body shape, eyes, decorations, and element-specific
// features (flames, fins, leaves, horns, rays, ears) are all rng-driven.
export function generateMonsterSprite(mt) {
  const S = 128;
  const c = makeCanvas(S, S);
  const ctx = c.getContext("2d");
  const pal = paletteFor(mt.element);
  const rng = rngFor(mt.typeName + "|" + mt.element);

  const cx = S / 2;
  const cy = S * 0.55;
  const ckey = canonicalElement(mt.element);
  const shape = shapeFor(ckey, rng);
  const sizeFactor = (mt.size || 2);
  const baseW = 28 + sizeFactor * 3 + rng.float(-2, 4);
  const bodyW = baseW * (shape.sx || 1);
  const bodyH = baseW * rng.float(0.9, 1.25) * (shape.sy || 1);

  // Ground shadow
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(cx, S * 0.9, bodyW * 0.95, bodyW * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Element features behind the body
  drawElementFeatures(ctx, ckey, pal, rng, cx, cy, bodyW, bodyH);

  // Body (gradient silhouette with outline) — shape varies by element.
  const grad = ctx.createLinearGradient(0, cy - bodyH, 0, cy + bodyH);
  grad.addColorStop(0, rgb(shade(pal.base, 0.12)));
  grad.addColorStop(0.55, rgb(pal.base));
  grad.addColorStop(1, rgb(pal.dark));
  ctx.fillStyle = grad;
  ctx.strokeStyle = rgb(shade(pal.dark, -0.05));
  ctx.lineWidth = 3;
  traceBlob(ctx, cx, cy, bodyW, bodyH, shape);
  ctx.fill();
  ctx.stroke();

  // Belly highlight
  ctx.fillStyle = rgba(shade(pal.accent, 0.1), 0.25);
  ctx.beginPath();
  ctx.ellipse(cx, cy + bodyH * 0.28, bodyW * 0.5, bodyH * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  // Rarity-driven spots
  const spots = Math.min(8, (mt.rarity || 1) + rng.int(0, 1));
  ctx.fillStyle = rgba(pal.dark, 0.3);
  for (let i = 0; i < spots; i++) {
    const a = rng.float(0, Math.PI * 2);
    const r = rng.float(0.15, 0.65);
    const sx = cx + Math.cos(a) * r * bodyW;
    const sy = cy + Math.sin(a) * r * bodyH;
    ctx.beginPath();
    ctx.arc(sx, sy, rng.float(2.5, 5.5), 0, Math.PI * 2);
    ctx.fill();
  }

  drawEyes(ctx, pal, rng, cx, cy - bodyH * 0.12, bodyW);

  return c;
}

function drawEyes(ctx, pal, rng, cx, eyeY, bodyW) {
  const cyclops = rng.chance(0.12);
  const eyeR = rng.float(6, 9);
  const spread = bodyW * rng.float(0.32, 0.45);
  const positions = cyclops ? [0] : [-spread, spread];

  for (const ox of positions) {
    const ex = cx + ox;
    const er = cyclops ? eyeR * 1.4 : eyeR;
    // White
    ctx.fillStyle = "rgba(250,250,255,0.95)";
    ctx.beginPath();
    ctx.arc(ex, eyeY, er, 0, Math.PI * 2);
    ctx.fill();
    // Pupil (element-tinted)
    ctx.fillStyle = rgb(shade(pal.dark, -0.08));
    ctx.beginPath();
    ctx.arc(ex + rng.float(-1, 1), eyeY + rng.float(-1, 1), er * 0.5, 0, Math.PI * 2);
    ctx.fill();
    // Glint
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(ex - er * 0.25, eyeY - er * 0.3, er * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawElementFeatures(ctx, ckey, pal, rng, cx, cy, bodyW, bodyH) {
  const top = cy - bodyH;
  switch (ckey) {
    case "fire": {
      // Flame spikes along the top
      const n = rng.int(3, 5);
      for (let i = 0; i < n; i++) {
        const fx = cx + (i - (n - 1) / 2) * (bodyW / n) * 1.4;
        const fh = rng.float(14, 26);
        ctx.fillStyle = rgb(shade(pal.accent, 0.05));
        ctx.beginPath();
        ctx.moveTo(fx - 7, top + 6);
        ctx.quadraticCurveTo(fx, top - fh, fx + 7, top + 6);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case "water": {
      // Side fins + tail
      ctx.fillStyle = rgb(shade(pal.accent, -0.02));
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + dir * bodyW * 0.7, cy);
        ctx.lineTo(cx + dir * (bodyW + rng.float(14, 22)), cy - rng.float(6, 14));
        ctx.lineTo(cx + dir * (bodyW + rng.float(10, 18)), cy + rng.float(8, 16));
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case "nature": {
      // Leaves sprouting from the top
      const n = rng.int(2, 4);
      ctx.fillStyle = rgb(shade(pal.accent, -0.05));
      for (let i = 0; i < n; i++) {
        const lx = cx + rng.float(-bodyW * 0.5, bodyW * 0.5);
        const ang = rng.float(-0.6, 0.6);
        ctx.save();
        ctx.translate(lx, top + 4);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.ellipse(0, -10, 5, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    case "dark": {
      // Horns
      ctx.fillStyle = rgb(shade(pal.dark, -0.04));
      for (const dir of [-1, 1]) {
        const hx = cx + dir * bodyW * 0.45;
        ctx.beginPath();
        ctx.moveTo(hx - 5, top + 8);
        ctx.lineTo(hx + dir * 10, top - rng.float(16, 24));
        ctx.lineTo(hx + 5, top + 8);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case "light": {
      // Halo / radiating rays behind body
      ctx.strokeStyle = rgba(pal.accent, 0.5);
      ctx.lineWidth = 3;
      const n = 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * bodyW * 1.05, cy + Math.sin(a) * bodyH * 1.05);
        ctx.lineTo(cx + Math.cos(a) * bodyW * 1.4, cy + Math.sin(a) * bodyH * 1.4);
        ctx.stroke();
      }
      break;
    }
    case "air": {
      // Soft translucent wings on each side
      ctx.fillStyle = rgba(shade(pal.accent, 0.08), 0.5);
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + dir * bodyW * 0.5, cy - bodyH * 0.2);
        ctx.quadraticCurveTo(cx + dir * (bodyW + 34), cy - bodyH * 0.9, cx + dir * (bodyW + 8), cy + bodyH * 0.25);
        ctx.quadraticCurveTo(cx + dir * (bodyW + 16), cy - bodyH * 0.1, cx + dir * bodyW * 0.5, cy - bodyH * 0.2);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case "ice": {
      // Sharp crystal shards along the top
      const n = rng.int(3, 5);
      ctx.fillStyle = rgba(shade(pal.accent, 0.12), 0.92);
      ctx.strokeStyle = rgb(pal.dark);
      ctx.lineWidth = 1.5;
      for (let i = 0; i < n; i++) {
        const fx = cx + (i - (n - 1) / 2) * (bodyW / n) * 1.3;
        const fh = rng.float(16, 28);
        ctx.beginPath();
        ctx.moveTo(fx - 5, top + 8);
        ctx.lineTo(fx + rng.float(-2, 2), top - fh);
        ctx.lineTo(fx + 5, top + 8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case "earth": {
      // Chunky rocks clustered at the lower sides
      ctx.fillStyle = rgb(shade(pal.dark, 0.05));
      ctx.strokeStyle = rgb(shade(pal.dark, -0.06));
      ctx.lineWidth = 2;
      for (const dir of [-1, 1]) {
        const rx = cx + dir * bodyW * 0.85;
        const ry = cy + bodyH * 0.45 + rng.float(-4, 4);
        const s = rng.float(8, 13);
        ctx.beginPath();
        ctx.moveTo(rx - s, ry);
        ctx.lineTo(rx - s * 0.4, ry - s);
        ctx.lineTo(rx + s * 0.6, ry - s * 0.7);
        ctx.lineTo(rx + s, ry + s * 0.2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case "electric": {
      // Jagged lightning bolts above
      ctx.strokeStyle = rgb(shade(pal.accent, 0.1));
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      const n = rng.int(2, 3);
      for (let i = 0; i < n; i++) {
        const bx = cx + (i - (n - 1) / 2) * 18;
        ctx.beginPath();
        ctx.moveTo(bx, top - 26);
        ctx.lineTo(bx + 6, top - 13);
        ctx.lineTo(bx - 5, top - 7);
        ctx.lineTo(bx + 5, top + 6);
        ctx.stroke();
      }
      break;
    }
    case "poison": {
      // Rising bubbles
      ctx.fillStyle = rgba(shade(pal.accent, 0.08), 0.7);
      ctx.strokeStyle = rgb(pal.dark);
      ctx.lineWidth = 1.5;
      const n = rng.int(4, 6);
      for (let i = 0; i < n; i++) {
        const bx = cx + rng.float(-bodyW * 0.7, bodyW * 0.7);
        const by = top - rng.float(0, 26);
        ctx.beginPath();
        ctx.arc(bx, by, rng.float(3, 7), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case "arcane": {
      // Orbiting motes on a tilted ring
      ctx.strokeStyle = rgba(pal.accent, 0.5);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, bodyW * 1.35, bodyH * 0.5, -0.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = rgb(shade(pal.accent, 0.1));
      const n = rng.int(3, 5);
      for (let i = 0; i < n; i++) {
        const a = rng.float(0, Math.PI * 2);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * bodyW * 1.35, cy + Math.sin(a) * bodyH * 0.5, rng.float(2.5, 4.5), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "celestial": {
      // Halo ring overhead + scattered sparkles
      ctx.strokeStyle = rgba(shade(pal.accent, 0.1), 0.75);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(cx, top - 2, bodyW * 0.55, bodyW * 0.18, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = rgba(shade(pal.accent, 0.15), 0.95);
      const n = rng.int(3, 5);
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.arc(cx + rng.float(-bodyW, bodyW), cy + rng.float(-bodyH, bodyH * 0.4), rng.float(1.6, 3), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "metal": {
      // Plated bumps with rivets
      ctx.fillStyle = rgb(shade(pal.accent, 0.05));
      ctx.strokeStyle = rgb(pal.dark);
      ctx.lineWidth = 2;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(cx + dir * bodyW * 0.5, top + 10, rng.float(7, 10), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = rgb(pal.dark);
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(cx - 10 + i * 10, top + 10, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "chaos": {
      // Asymmetric jagged spikes radiating out
      ctx.fillStyle = rgb(shade(pal.dark, -0.02));
      const n = rng.int(5, 8);
      for (let i = 0; i < n; i++) {
        const a = rng.float(0, Math.PI * 2);
        const x0 = cx + Math.cos(a) * bodyW * 0.9, y0 = cy + Math.sin(a) * bodyH * 0.9;
        const len = rng.float(8, 18);
        const x1 = cx + Math.cos(a) * (bodyW * 0.9 + len), y1 = cy + Math.sin(a) * (bodyH * 0.9 + len);
        const perp = a + Math.PI / 2, w = rng.float(3, 5);
        ctx.beginPath();
        ctx.moveTo(x0 + Math.cos(perp) * w, y0 + Math.sin(perp) * w);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x0 - Math.cos(perp) * w, y0 - Math.sin(perp) * w);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    default: {
      // Neutral / unknown — rounded ears
      ctx.fillStyle = rgb(pal.base);
      ctx.strokeStyle = rgb(pal.dark);
      ctx.lineWidth = 2;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(cx + dir * bodyW * 0.5, top + 8, rng.float(7, 11), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}

// ─── Ground tiles ───
// Flat colour from the tile's colour profile, with procedural speckle texture.
// Collidable tiles get a chunky rock blob so obstacles read clearly.
export function generateTileSprite(tile) {
  const S = 128;
  const c = makeCanvas(S, S);
  const ctx = c.getContext("2d");
  const base = [
    tile.colorProfile_full_r ?? 60,
    tile.colorProfile_full_g ?? 70,
    tile.colorProfile_full_b ?? 60,
  ];
  const rng = rngFor(tile.name || tile.imagePath || "tile");

  // Base fill with a soft diagonal gradient for depth
  const grad = ctx.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0, rgb(shade(base, 0.05)));
  grad.addColorStop(1, rgb(shade(base, -0.05)));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);

  // Speckle texture
  const speckles = 70;
  for (let i = 0; i < speckles; i++) {
    const amt = rng.float(-0.12, 0.12);
    ctx.fillStyle = rgba(shade(base, amt), rng.float(0.15, 0.4));
    const sx = rng.float(0, S);
    const sy = rng.float(0, S);
    const sz = rng.float(2, 7);
    ctx.fillRect(sx, sy, sz, sz);
  }

  if (tile.collidable) {
    // Rock obstacle
    const rockC = shade(base, -0.15);
    ctx.fillStyle = rgb(rockC);
    ctx.strokeStyle = rgb(shade(base, -0.3));
    ctx.lineWidth = 3;
    ctx.beginPath();
    const cx = S / 2 + rng.float(-8, 8);
    const cy = S / 2 + rng.float(-8, 8);
    const pts = 7;
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const r = S * 0.3 * rng.float(0.8, 1.1);
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Highlight
    ctx.fillStyle = rgba(shade(base, 0.2), 0.4);
    ctx.beginPath();
    ctx.ellipse(cx - 8, cy - 8, S * 0.1, S * 0.07, -0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Edge vignette so tiles read as a grid
  ctx.strokeStyle = rgba(shade(base, -0.25), 0.5);
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, S - 4, S - 4);

  return c;
}

// ─── Player ───
// Simple top-down adventurer.
export function generatePlayerSprite() {
  // Static icon — a hooded, cloaked spirit-tamer holding a glowing spirit chain,
  // matching the animated drawCharacter and the concept art.
  const S = 64;
  const c = makeCanvas(S, S);
  const ctx = c.getContext("2d");
  const cx = S / 2;
  const accent = "70, 230, 198"; // teal glow
  const ellipse = (x, y, rx, ry, fill) => {
    ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  };

  // Ground shadow
  ellipse(cx, S - 6, 14, 4.5, "rgba(0,0,0,0.3)");

  // Lower cloak + tattered hem
  ellipse(cx, S - 18, 14, 18, "rgb(24,21,34)");
  ctx.fillStyle = "rgb(14,12,22)";
  for (let i = -2; i <= 2; i++) {
    const hh = 6 + (Math.abs(i) % 2) * 5 + (i === 0 ? 3 : 0);
    ctx.beginPath(); ctx.roundRect(cx + i * 5.2 - 2.4, S - 8, 4.8, hh, 1); ctx.fill();
  }

  // Shoulders + cool rim light
  ellipse(cx, S - 34, 11, 12, "rgb(24,21,34)");
  ctx.globalAlpha = 0.18; ellipse(cx - 8, S - 32, 3.2, 13, `rgb(${accent})`); ctx.globalAlpha = 1;

  // Hood / cowl (pointed)
  ellipse(cx, S - 46, 10, 11, "rgb(24,21,34)");
  ellipse(cx, S - 52, 6, 7, "rgb(24,21,34)");
  ellipse(cx - 3.5, S - 47, 2.6, 8, "rgba(70,230,198,0.16)");

  // Spirit-chain ring held to the side
  const rx = cx + 17, ry = S - 30;
  ctx.globalAlpha = 0.14; ellipse(rx, ry, 13, 13, `rgb(${accent})`); ctx.globalAlpha = 1;
  ctx.globalAlpha = 0.22; ellipse(rx, ry, 8, 8, `rgb(${accent})`); ctx.globalAlpha = 1;
  ctx.strokeStyle = `rgb(${accent})`; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(rx, ry, 7, 0, Math.PI * 2); ctx.stroke();
  // arm to the ring
  ctx.strokeStyle = "rgb(24,21,34)"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(cx + 7, S - 32); ctx.lineTo(rx, ry); ctx.stroke();
  // chain links + core
  ctx.fillStyle = "rgba(245,250,255,0.9)";
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath(); ctx.arc(rx + Math.cos(a) * 7, ry + Math.sin(a) * 7, 1.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.beginPath(); ctx.arc(rx, ry, 2.6, 0, Math.PI * 2); ctx.fill();

  return c;
}

// ─── Title background — haunted spirit-forest: a glowing portal framed by
// gnarled trees, hanging vines, fog and rune-lit gravestones (concept art) ───
export function generateTitleBackground(w = 1280, h = 720) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d");

  // Base vertical gradient (near-black violet, faintly lit toward the middle).
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgb(12, 10, 20)");
  g.addColorStop(0.45, "rgb(16, 20, 28)");
  g.addColorStop(1, "rgb(7, 6, 13)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  const px = w / 2, py = h * 0.40;

  // Spirit portal — radial glow + concentric rings + bright core.
  const rg = ctx.createRadialGradient(px, py, 0, px, py, 440);
  rg.addColorStop(0, "rgba(190, 255, 240, 0.85)");
  rg.addColorStop(0.12, "rgba(70, 230, 198, 0.5)");
  rg.addColorStop(0.4, "rgba(60, 150, 150, 0.16)");
  rg.addColorStop(1, "rgba(40, 80, 90, 0)");
  ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(px, py, 440, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(150, 255, 235, 0.5)";
  for (let i = 0; i < 5; i++) {
    ctx.lineWidth = 2 + i * 0.6; ctx.globalAlpha = 0.5 - i * 0.08;
    ctx.beginPath(); ctx.arc(px, py, 30 + i * 22, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(232, 255, 250, 0.95)";
  ctx.beginPath(); ctx.arc(px, py, 15, 0, Math.PI * 2); ctx.fill();

  // Glowing steps leading up to the portal.
  ctx.fillStyle = "rgba(90, 200, 175, 0.10)";
  for (let i = 0; i < 6; i++) ctx.fillRect(px - (60 + i * 26) / 2, py + 70 + i * 22, 60 + i * 26, 12);

  // Dark canopy arch across the top.
  ctx.fillStyle = "rgb(9, 8, 15)";
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, h * 0.16);
  ctx.quadraticCurveTo(w * 0.5, h * 0.40, 0, h * 0.16); ctx.closePath(); ctx.fill();

  // Gnarled trees framing left & right.
  const tree = (baseX, dir) => {
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgb(11, 10, 18)"; ctx.lineWidth = 48;
    ctx.beginPath(); ctx.moveTo(baseX, h);
    ctx.quadraticCurveTo(baseX + dir * 30, h * 0.55, baseX + dir * 72, h * 0.30); ctx.stroke();
    ctx.lineWidth = 18;
    for (let i = 0; i < 4; i++) {
      const by = h * (0.62 - i * 0.11);
      ctx.beginPath(); ctx.moveTo(baseX + dir * (20 + i * 12), by);
      ctx.quadraticCurveTo(baseX + dir * (60 + i * 30), by - 44, baseX + dir * (120 + i * 42), by - 96); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(70, 210, 178, 0.12)"; ctx.lineWidth = 4; // inner rim light
    ctx.beginPath(); ctx.moveTo(baseX + dir * 6, h);
    ctx.quadraticCurveTo(baseX + dir * 36, h * 0.55, baseX + dir * 78, h * 0.30); ctx.stroke();
  };
  tree(w * 0.07, 1); tree(w * 0.93, -1);

  // Hanging vines from the canopy.
  const rng = rngFor("title-vines");
  ctx.strokeStyle = "rgba(10, 9, 17, 0.9)"; ctx.lineWidth = 2;
  for (let i = 0; i < 24; i++) {
    const vx = rng.float(0, w), vl = rng.float(40, 170);
    ctx.beginPath(); ctx.moveTo(vx, 0); ctx.lineTo(vx + rng.float(-8, 8), vl); ctx.stroke();
  }

  // Rune-lit gravestones flanking the path.
  for (const gx of [w * 0.24, w * 0.76]) {
    ctx.fillStyle = "rgb(18, 17, 28)";
    ctx.beginPath(); ctx.roundRect(gx - 26, h * 0.64, 52, 92, [26, 26, 4, 4]); ctx.fill();
    ctx.strokeStyle = "rgba(70, 230, 198, 0.38)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(gx, h * 0.69, 10, 0, Math.PI * 2); ctx.stroke();
  }

  // Ground fog bands + drifting spirit motes.
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = `rgba(80, 200, 170, ${0.06 - i * 0.012})`;
    ctx.fillRect(0, h * 0.74 + i * 22, w, 18);
  }
  const rng2 = rngFor("title-motes");
  for (let i = 0; i < 120; i++) {
    const x = rng2.float(0, w), y = rng2.float(0, h * 0.88);
    ctx.fillStyle = `rgba(150, 255, 230, ${rng2.float(0.05, 0.42)})`;
    ctx.beginPath(); ctx.arc(x, y, rng2.float(0.5, 1.8), 0, Math.PI * 2); ctx.fill();
  }

  return c;
}

// ─── Title frame — thin inset rule with soft teal corners ───
export function generateTitleBorder(w = 1280, h = 720) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d");
  const m = 24;
  ctx.strokeStyle = "rgba(34,211,176,0.28)";
  ctx.lineWidth = 2;
  ctx.strokeRect(m, m, w - m * 2, h - m * 2);
  // Brighter corner accents.
  ctx.strokeStyle = "rgba(34,211,176,0.85)";
  ctx.lineWidth = 3;
  const L = 34;
  for (const [cx, cy, sx, sy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * L, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * L);
    ctx.stroke();
  }
  return c;
}
