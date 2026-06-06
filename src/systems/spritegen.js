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
  Fire: { base: [222, 74, 40], accent: [255, 184, 66], dark: [120, 32, 22] },
  Water: { base: [52, 122, 220], accent: [138, 206, 255], dark: [24, 60, 132] },
  Nature: { base: [72, 168, 84], accent: [176, 230, 116], dark: [34, 90, 46] },
  Dark: { base: [112, 72, 152], accent: [184, 134, 222], dark: [46, 28, 70] },
  Light: { base: [240, 220, 122], accent: [255, 250, 224], dark: [186, 152, 58] },
  Neutral: { base: [150, 150, 162], accent: [212, 212, 224], dark: [78, 78, 92] },
};

function paletteFor(element) {
  return ELEMENT_PALETTES[element] || ELEMENT_PALETTES.Neutral;
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
  const S = 64;
  const c = makeCanvas(S, S);
  const ctx = c.getContext("2d");
  const cx = S / 2;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(cx, S - 8, 16, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Cloak / body
  ctx.fillStyle = "rgb(70, 90, 140)";
  ctx.strokeStyle = "rgb(40, 55, 90)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 14, S - 12);
  ctx.quadraticCurveTo(cx, S - 44, cx + 14, S - 12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Head
  ctx.fillStyle = "rgb(225, 190, 160)";
  ctx.strokeStyle = "rgb(150, 110, 90)";
  ctx.beginPath();
  ctx.arc(cx, S - 40, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Hat brim
  ctx.fillStyle = "rgb(120, 70, 50)";
  ctx.beginPath();
  ctx.ellipse(cx, S - 46, 15, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  return c;
}

// ─── Title background (gradient + vignette + drifting motes baked in) ───
export function generateTitleBackground(w = 1280, h = 720) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d");

  const grad = ctx.createRadialGradient(w / 2, h * 0.4, h * 0.1, w / 2, h * 0.5, h);
  grad.addColorStop(0, "rgb(38, 30, 60)");
  grad.addColorStop(0.6, "rgb(20, 16, 36)");
  grad.addColorStop(1, "rgb(8, 6, 16)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Scattered stars / motes
  const rng = rngFor("title-bg");
  for (let i = 0; i < 160; i++) {
    const x = rng.float(0, w);
    const y = rng.float(0, h);
    const r = rng.float(0.5, 2.2);
    ctx.fillStyle = `rgba(200, 200, 255, ${rng.float(0.1, 0.6)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  return c;
}

// ─── Ornate border overlay (transparent center) ───
export function generateTitleBorder(w = 1280, h = 720) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d");
  const m = 24; // margin

  ctx.strokeStyle = "rgb(180, 150, 90)";
  ctx.lineWidth = 6;
  ctx.strokeRect(m, m, w - m * 2, h - m * 2);

  ctx.strokeStyle = "rgba(120, 100, 60, 0.8)";
  ctx.lineWidth = 2;
  ctx.strokeRect(m + 10, m + 10, w - (m + 10) * 2, h - (m + 10) * 2);

  // Corner flourishes
  const corners = [
    [m, m, 1, 1],
    [w - m, m, -1, 1],
    [m, h - m, 1, -1],
    [w - m, h - m, -1, -1],
  ];
  ctx.strokeStyle = "rgb(210, 180, 110)";
  ctx.lineWidth = 4;
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + sx * 40, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * 40);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + sx * 18, y + sy * 18, 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  return c;
}
