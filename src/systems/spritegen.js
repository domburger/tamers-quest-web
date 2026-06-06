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
  const sizeFactor = (mt.size || 2);
  const bodyW = 28 + sizeFactor * 3 + rng.float(-2, 4);
  const bodyH = bodyW * rng.float(0.9, 1.25);

  // Ground shadow
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(cx, S * 0.9, bodyW * 0.95, bodyW * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Element features behind the body
  drawElementFeatures(ctx, mt.element, pal, rng, cx, cy, bodyW, bodyH);

  // Body (gradient blob with outline)
  const grad = ctx.createLinearGradient(0, cy - bodyH, 0, cy + bodyH);
  grad.addColorStop(0, rgb(shade(pal.base, 0.12)));
  grad.addColorStop(0.55, rgb(pal.base));
  grad.addColorStop(1, rgb(pal.dark));
  ctx.fillStyle = grad;
  ctx.strokeStyle = rgb(shade(pal.dark, -0.05));
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx, cy, bodyW, bodyH, 0, 0, Math.PI * 2);
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

function drawElementFeatures(ctx, element, pal, rng, cx, cy, bodyW, bodyH) {
  const top = cy - bodyH;
  switch (element) {
    case "Fire": {
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
    case "Water": {
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
    case "Nature": {
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
    case "Dark": {
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
    case "Light": {
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
    default: {
      // Neutral — rounded ears
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
  // Static flat explorer icon — matches the animated drawCharacter look.
  const S = 64;
  const c = makeCanvas(S, S);
  const ctx = c.getContext("2d");
  const cx = S / 2;
  const ellipse = (x, y, rx, ry, fill) => {
    ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  };
  const rrect = (x, y, w, h, r, fill) => {
    ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, r); ctx.fill();
  };

  // Ground shadow
  ellipse(cx, S - 7, 14, 4.5, "rgba(0,0,0,0.22)");

  // Boots + legs
  rrect(cx - 6, S - 16, 7, 14, 3, "rgb(36,52,82)");
  rrect(cx + 6, S - 16, 7, 14, 3, "rgb(36,52,82)");
  rrect(cx - 6, S - 10, 8, 6, 2, "rgb(58,44,38)");
  rrect(cx + 6, S - 10, 8, 6, 2, "rgb(58,44,38)");

  // Backpack edge
  rrect(cx - 11, S - 30, 10, 18, 4, "rgb(96,74,52)");

  // Torso — two-tone flat shading (water-blue tunic)
  ellipse(cx, S - 27, 13, 15, "rgb(36,86,162)");
  ellipse(cx, S - 30, 11.5, 12, "rgb(62,128,224)");
  ctx.globalAlpha = 0.6; ellipse(cx - 3, S - 33, 5.5, 5.5, "rgb(120,180,255)"); ctx.globalAlpha = 1;
  rrect(cx, S - 20, 22, 4, 2, "rgb(58,44,38)"); // belt

  // Arm + glove
  rrect(cx + 12, S - 28, 6, 13, 3, "rgb(62,128,224)");
  ellipse(cx + 13, S - 21, 3, 3, "rgb(232,200,165)");

  // Lantern glow + body
  ctx.globalAlpha = 0.5; ellipse(cx + 15, S - 17, 9, 9, "rgb(255,200,96)"); ctx.globalAlpha = 1;
  rrect(cx + 15, S - 17, 7, 9, 2, "rgb(60,52,44)");
  rrect(cx + 15, S - 17, 5, 6, 1, "rgb(255,222,138)");

  // Head
  ellipse(cx, S - 42, 9, 9, "rgb(208,176,142)");
  ellipse(cx - 1.5, S - 43, 8, 8, "rgb(232,200,165)");
  ctx.fillStyle = "rgb(36,30,28)";
  ctx.beginPath(); ctx.arc(cx - 3, S - 42, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 3, S - 42, 1.6, 0, Math.PI * 2); ctx.fill();

  // Explorer cap — brim, dome, accent band
  ellipse(cx + 1, S - 49, 14, 5, "rgb(86,62,46)");
  ellipse(cx, S - 52, 8, 7, "rgb(86,62,46)");
  rrect(cx, S - 49, 16, 3, 1, "rgb(120,180,255)");

  return c;
}

// ─── Title background — crisp daylight flat: light field, soft element blobs,
// and a clean flat cave-mouth silhouette anchoring the theme ───
export function generateTitleBackground(w = 1280, h = 720) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d");

  // Flat light field
  ctx.fillStyle = "rgb(238, 240, 244)";
  ctx.fillRect(0, 0, w, h);

  // Large, soft, flat element-colored shapes — monster-taming color identity.
  const blobs = [
    [w * 0.14, h * 0.20, 220, "rgba(43,127,224,0.10)"],   // water
    [w * 0.88, h * 0.16, 260, "rgba(240,69,45,0.09)"],    // fire
    [w * 0.80, h * 0.78, 240, "rgba(52,168,83,0.10)"],    // nature
    [w * 0.20, h * 0.82, 200, "rgba(245,197,59,0.10)"],   // light
  ];
  for (const [x, y, r, fill] of blobs) {
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // Subtle flat dot grid for texture (very low contrast).
  ctx.fillStyle = "rgba(22,26,34,0.05)";
  for (let gx = 40; gx < w; gx += 44) {
    for (let gy = 40; gy < h; gy += 44) {
      ctx.beginPath(); ctx.arc(gx, gy, 1.4, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Flat cave-mouth silhouette across the bottom — the "cave crawling" anchor.
  const baseY = h;
  ctx.fillStyle = "rgb(214, 219, 227)";
  ctx.beginPath();
  ctx.moveTo(0, baseY);
  ctx.lineTo(0, h * 0.80);
  // jagged rocky lip
  const rng = rngFor("title-cave");
  const segs = 16;
  for (let i = 0; i <= segs; i++) {
    const x = (w / segs) * i;
    const y = h * 0.80 + rng.float(-26, 26);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, baseY);
  ctx.closePath();
  ctx.fill();

  // Darker inner cave arch (a flat, friendly hint of depth — not gloomy).
  ctx.fillStyle = "rgb(193, 200, 210)";
  ctx.beginPath();
  ctx.ellipse(w / 2, h + 40, w * 0.26, h * 0.34, 0, Math.PI, 0, true);
  ctx.fill();

  return c;
}

// ─── Title frame — thin flat double rule, no ornamentation ───
export function generateTitleBorder(w = 1280, h = 720) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d");
  const m = 22;
  ctx.strokeStyle = "rgba(43,127,224,0.55)";
  ctx.lineWidth = 3;
  ctx.strokeRect(m, m, w - m * 2, h - m * 2);
  return c;
}
