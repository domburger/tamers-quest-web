// Procedural sprite generation — replaces the PNG asset pipeline with
// deterministic canvas art driven by game data. Every generator returns an
// HTMLCanvasElement, which Kaboom's loadSprite() accepts directly.

import { makeRng as rngFor } from "../engine/rng.js";
import { BODY_SHAPES } from "./monsterModel.js";

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

const SPRITE_PALETTES = {
  fire:      { base: [222, 74, 40],   accent: [255, 184, 66],  dark: [120, 32, 22] },
  water:     { base: [52, 122, 220],  accent: [138, 206, 255], dark: [24, 60, 132] },
  nature:    { base: [72, 168, 84],   accent: [176, 230, 116], dark: [34, 90, 46] },
  light:     { base: [240, 220, 122], accent: [255, 250, 224], dark: [186, 152, 58] },
  dark:      { base: [112, 72, 152],  accent: [184, 134, 222], dark: [46, 28, 70] },
  neutral:   { base: [150, 150, 162], accent: [212, 212, 224], dark: [78, 78, 92] },
  // Expanded palette set so monsters read distinctly (was all-gray before).
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

// Deterministic visual theme per monster. TQ-349 removed the "element" concept, so a
// monster's palette / eye-glow / flair are now seeded from a stable hash of its NAME (so
// it always renders the same way) instead of an element. The palette KEYS are just
// internal colour-theme ids, not a game-facing taxonomy.
const PALETTE_KEYS = Object.keys(SPRITE_PALETTES);
export function visualKey(typeName) {
  const s = String(typeName || "");
  let h = 2166136261 >>> 0; // FNV-1a → a stable index into PALETTE_KEYS
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return PALETTE_KEYS[(h >>> 0) % PALETTE_KEYS.length] || "neutral";
}
export function paletteFor(key) {
  return SPRITE_PALETTES[key] || SPRITE_PALETTES.neutral;
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// ─── Monster sprites ───
// PT1-T21 / P5-T5 (user: "brutal, not cute, not all egg-shaped"). Every monster
// is built from one of six ANIMAL ARCHETYPES, each with its own silhouette,
// stance and visual weight — quadruped beast, avian raptor, sprawling saurian,
// finned leviathan, segmented arthropod, hulking brute — so a random lineup
// reads as a menagerie of distinct predators rather than a row of eggs. The
// archetype is chosen deterministically from the monster's name/description
// (with colour-theme + seeded fallbacks), so the same monster always looks identical.
// (This supersedes the earlier traceBlob/drawLegs/drawTail "egg + limbs" pass —
// that produced one silhouette family; archetypes give real silhouette variety.)

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Pick an animal archetype from the monster's name + flavour text, falling back
// to a colour-theme default and finally a seeded choice so rosters vary. Pure + seeded.
export function archetypeFor(mt, ckey, rng) {
  // The archetype renderer is the FALLBACK for monsters with no authored shape model (the offline
  // seed bundle): pick a silhouette from the name/description, then a theme default, then seeded.
  const txt = (String(mt.typeName || "") + " " + String(mt.description || "")).toLowerCase();
  const has = (...ws) => ws.some((w) => txt.includes(w));
  if (has("golem", "titan", "colossus", "ogre", "troll", "brute", "giant", "construct",
          "juggernaut", "behemoth", "stone", "rock", "boulder", "guardian", "sentinel", "gargoyle"))
    return "brute";
  if (has("spider", "scorpion", "beetle", "mantis", "ant ", "wasp", "bug", "insect", "chitin",
          "carapace", "crab", "centipede", "swarm", "hornet", "locust", "roach", "stinger", "mite"))
    return "arthropod";
  if (has("dragon", "drake", "wyrm", "wyvern", "lizard", "reptil", "serpent", "basilisk",
          "salamander", "croc", "gecko", "saur", "draconic", "hydra", "viper", "cobra", "snake"))
    return "saurian";
  if (has("aqua", "fish", "fin", "eel", "squid", "octo", "tide", "wave", "ocean", "jelly",
          "kraken", "shark", "leviathan", "drifter", "whale", "ray", "abyss", "coral", "tentacle"))
    return "leviathan";
  if (has("bird", "wing", "feather", "avian", "hawk", "owl", "raven", "crow", "beak", "harpy",
          "phoenix", "eagle", "falcon", "griffin", "talon", "plume", "moth", "wisp", "sprite"))
    return "raptor";
  if (has("wolf", "cat", "lynx", "paw", "hound", "bear", "fox", "lion", "ram", "boar", "beast",
          "fur", "feline", "canine", "tiger", "panther", "stag", "mammoth", "ape", "fang", "maw",
          "prowl", "claw"))
    return "beast";
  // Theme-tilted default — nudges the silhouette by colour theme, but isn't a hard rule.
  const byEl = {
    water: "leviathan", ice: "leviathan", air: "raptor", celestial: "raptor", light: "raptor",
    earth: "brute", metal: "brute", poison: "arthropod", nature: "arthropod",
    dark: "saurian", arcane: "saurian", electric: "saurian", fire: "beast", chaos: "beast",
  };
  if (byEl[ckey] && rng.chance(0.55)) return byEl[ckey];
  return BODY_SHAPES[rng.int(0, BODY_SHAPES.length - 1)];
}

// A darker, heavier palette derived from the theme palette: body desaturated +
// dimmed for "weight," accent kept bright for the rim/eyes/features.
function menacePalette(pal0) {
  return {
    base: shade(pal0.base, -0.10),
    dark: shade(pal0.dark, -0.05),
    accent: pal0.accent,
    bone: [228, 222, 206], // fangs / claws / horns
  };
}

// A luminous, threatening eye colour per colour-theme (red for the sinister themes).
export function eyeGlowFor(ckey) {
  switch (ckey) {
    case "fire": return [255, 176, 56];
    case "dark": case "chaos": case "poison": return [255, 72, 58];
    case "ice": case "water": case "air": return [150, 232, 255];
    case "electric": case "light": return [255, 244, 150];
    case "nature": return [178, 255, 120];
    case "arcane": return [206, 150, 255];
    default: return [255, 96, 66];
  }
}

// Where this archetype's themed flair (flames/shards/leaves/rings) should anchor:
// `top` ≈ the silhouette's highest point so "above" flair hugs the creature, `cy`
// ≈ its vertical centre for the side/ring flair, `halfW` ≈ its half-width. Kept as
// cheap approximations of each archetype's proportions (tall vs low, wide vs narrow)
// so the flair no longer floats at a fixed canvas height above the shorter bodies.
function flairAnchor(arch, ground, bulk) {
  switch (arch) {
    case "raptor":    return { top: ground - 40 * bulk - 30, cy: ground - 40 * bulk, halfW: 17 * bulk };
    case "leviathan": return { top: ground - 78 * bulk - 4,  cy: ground - 44 * bulk, halfW: 18 * bulk };
    case "brute":     return { top: ground - 76 * bulk - 6,  cy: ground - 44 * bulk, halfW: 26 * bulk };
    case "saurian":   return { top: ground - 24 * bulk - 22, cy: ground - 26 * bulk, halfW: 26 * bulk };
    case "arthropod": return { top: ground - 24 * bulk - 16, cy: ground - 24 * bulk, halfW: 24 * bulk };
    default:          return { top: ground - 30 * bulk - 24, cy: ground - 30 * bulk, halfW: 26 * bulk }; // beast
  }
}

// ── Low-level drawing primitives shared by the archetypes ──
function limbPath(ctx, x1, y1, x2, y2, w1, w2) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const px = Math.cos(a + Math.PI / 2), py = Math.sin(a + Math.PI / 2);
  ctx.beginPath();
  ctx.moveTo(x1 + px * w1, y1 + py * w1);
  ctx.lineTo(x2 + px * w2, y2 + py * w2);
  ctx.lineTo(x2 - px * w2, y2 - py * w2);
  ctx.lineTo(x1 - px * w1, y1 - py * w1);
  ctx.closePath();
}
function fillLimb(ctx, pal, x1, y1, x2, y2, w1, w2, far) {
  ctx.fillStyle = rgb(shade(far ? pal.dark : pal.base, far ? -0.05 : -0.02));
  ctx.strokeStyle = rgb(shade(pal.dark, -0.10));
  ctx.lineWidth = 2; ctx.lineJoin = "round";
  limbPath(ctx, x1, y1, x2, y2, w1, w2);
  ctx.fill(); ctx.stroke();
}
function drawClaws(ctx, x, y, n, len, spread, col, dy = 1) {
  ctx.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const ox = (i - (n - 1) / 2) * spread;
    ctx.beginPath();
    ctx.moveTo(x + ox - 1.7, y);
    ctx.lineTo(x + ox + 1.7, y);
    ctx.lineTo(x + ox + 0.5, y + len * dy);
    ctx.closePath(); ctx.fill();
  }
}
function drawHorn(ctx, bx, by, tx, ty, w, col) {
  const a = Math.atan2(ty - by, tx - bx);
  const px = Math.cos(a + Math.PI / 2), py = Math.sin(a + Math.PI / 2);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(bx + px * w, by + py * w);
  ctx.lineTo(tx, ty);
  ctx.lineTo(bx - px * w, by - py * w);
  ctx.closePath(); ctx.fill();
}
// A toothy maw: a dark mouth gap with bone fangs top & (optionally) bottom.
function drawMaw(ctx, x, y, w, h, bone, underbite = false) {
  ctx.fillStyle = "rgba(14,8,12,0.92)";
  ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = rgb(bone);
  const n = 4;
  for (let i = 0; i < n; i++) {
    const fx = x + (i - (n - 1) / 2) * (w * 1.5 / n);
    ctx.beginPath();
    ctx.moveTo(fx - 1.8, y - h * 0.7);
    ctx.lineTo(fx + 1.8, y - h * 0.7);
    ctx.lineTo(fx, y - h * 0.7 + h * (underbite ? 1.4 : 1.1));
    ctx.closePath(); ctx.fill();
    if (underbite) {
      // tusks jutting up from the lower jaw
      ctx.beginPath();
      ctx.moveTo(fx - 1.6, y + h * 0.7);
      ctx.lineTo(fx + 1.6, y + h * 0.7);
      ctx.lineTo(fx, y + h * 0.7 - h * 1.3);
      ctx.closePath(); ctx.fill();
    }
  }
}
// Body silhouette helper: fill+rim a built path with the menace gradient.
function paintBody(ctx, pal, topY, botY, build) {
  const grad = ctx.createLinearGradient(0, topY, 0, botY);
  grad.addColorStop(0, rgb(shade(pal.base, 0.12)));
  grad.addColorStop(0.55, rgb(pal.base));
  grad.addColorStop(1, rgb(pal.dark));
  build();
  ctx.fillStyle = grad;
  ctx.strokeStyle = rgb(shade(pal.dark, -0.10));
  ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.fill(); ctx.stroke();
  build();
  ctx.strokeStyle = rgba(pal.accent, 0.4); ctx.lineWidth = 1.4; ctx.stroke();
}

// Menacing eyes (glowing, slit-pupilled, heavy-browed) placed on the head a given
// archetype reports. `front` → two eyes; otherwise a single forward profile eye.
function drawMenaceFace(ctx, pal, eyeGlow, head) {
  const { x, y, r, front } = head;
  const positions = front ? [-1, 1].map((s) => [x + s * r * 0.52, y, s]) : [[x, y, 1]];
  for (const [ex, ey, s] of positions) {
    const dir = front ? -s : 1; // inner edge toward the centre line
    // Recessed dark socket — the eye glares out of a shadowed hollow, not off a
    // bright round bead (the round glowing eye was the main "cute" tell).
    ctx.fillStyle = rgba(shade(pal.dark, -0.18), 0.85);
    ctx.beginPath(); ctx.ellipse(ex, ey, r * 0.5, r * 0.34, -dir * 0.3, 0, Math.PI * 2); ctx.fill();
    // Tight glow (smaller than before so it reads as a hot ember, not a halo).
    ctx.fillStyle = rgba(eyeGlow, 0.34);
    ctx.beginPath(); ctx.arc(ex, ey, r * 0.5, 0, Math.PI * 2); ctx.fill();
    // Narrow, angled almond + vertical slit — a predator's eye, not a wide bead.
    ctx.save();
    ctx.translate(ex, ey); ctx.rotate(-dir * 0.22);
    ctx.fillStyle = rgb(eyeGlow);
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.42, r * 0.18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(8,5,10,0.95)";
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.09, r * 0.17, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // Tiny cold glint.
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath(); ctx.arc(ex - r * 0.12, ey - r * 0.08, r * 0.05, 0, Math.PI * 2); ctx.fill();
    // Heavy brow, low + angled down toward the centre line (a hard scowl).
    ctx.strokeStyle = rgb(shade(pal.dark, -0.16));
    ctx.lineWidth = Math.max(2.2, r * 0.28); ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(ex - dir * r * 0.55, ey - r * 0.66);
    ctx.lineTo(ex + dir * r * 0.5, ey - r * 0.16);
    ctx.stroke();
  }
}

// Scattered battle scars + spots drawn on the torso box (menace + asymmetry).
function drawBattleMarks(ctx, pal, rng, mt, box) {
  const { x, y, w, h } = box;
  const spots = Math.min(7, (mt.rarity || 1) + rng.int(0, 1));
  ctx.fillStyle = rgba(pal.dark, 0.32);
  for (let i = 0; i < spots; i++) {
    const sx = x + rng.float(-w * 0.5, w * 0.5);
    const sy = y + rng.float(-h * 0.4, h * 0.45);
    ctx.beginPath(); ctx.arc(sx, sy, rng.float(2, 4.5), 0, Math.PI * 2); ctx.fill();
  }
  if (rng.chance(0.4)) { // battle scar — a short stitched slash
    const sa = rng.float(-0.6, 0.6);
    const scx = x + rng.float(-w * 0.25, w * 0.3), scy = y + rng.float(-h * 0.2, h * 0.25);
    const len = h * rng.float(0.5, 0.8);
    const dx = Math.cos(sa) * len * 0.5, dy = Math.sin(sa) * len * 0.5;
    ctx.strokeStyle = rgb(shade(pal.dark, -0.16)); ctx.lineCap = "round"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(scx - dx, scy - dy); ctx.lineTo(scx + dx, scy + dy); ctx.stroke();
    const nx = Math.cos(sa + Math.PI / 2), ny = Math.sin(sa + Math.PI / 2);
    ctx.lineWidth = 1.3;
    for (let t = -2; t <= 2; t++) {
      const mx = scx + (dx * t) / 3, my = scy + (dy * t) / 3;
      ctx.beginPath(); ctx.moveTo(mx - nx * 2.5, my - ny * 2.5); ctx.lineTo(mx + nx * 2.5, my + ny * 2.5); ctx.stroke();
    }
  }
}

// Supersample factor for the monster sprite bitmap. Combat displays a monster at ~0.26–0.3× the
// square play window (≈216px on a 1280×720 design canvas, more on HiDPI), so a flat 128px bitmap
// was magnified ~1.5–3.4× → soft/blurry. We render the SAME 128-unit art onto a RES× canvas
// (ctx.scale), keeping every draw coordinate unchanged, so the texture stays crisp when upscaled.
// Callers that draw the sprite at its natural texture size (charselect/lobby thumbnails via
// k.scale) divide their display scale by this. RES=2 (256px) is the memory-vs-sharpness sweet spot
// across ~115 preloaded types; the player sprite mirrors this pattern at RES=3 (one sprite).
export const MONSTER_SPRITE_RES = 2;

export function generateMonsterSprite(mt) {
  const S = 128;
  const RES = MONSTER_SPRITE_RES;
  const c = makeCanvas(S * RES, S * RES);
  const ctx = c.getContext("2d");
  ctx.scale(RES, RES); // draw in 128-unit space; output bitmap is RES× sharper
  // Procedural archetype renderer: this BAKES every hand-authored SEED monster's sprite at boot
  // (a name-seeded colour theme + a name-seeded silhouette from one of the BODY_SHAPES archetypes).
  // AI-generated monsters are NOT drawn here — they carry an authored SVG model (mt.svg, TQ-245)
  // that drawMonster lazily rasterizes into a sprite at runtime (TQ-246). The old LLM-authored-SHAPES
  // path (modelRender.drawAuthoredModel) was removed in the SVG cutover (TQ-242).
  const ckey = visualKey(mt.typeName);
  const pal0 = paletteFor(ckey);
  const pal = menacePalette(pal0);
  const rng = rngFor(mt.typeName);
  const eyeGlow = eyeGlowFor(ckey);

  const cx = S / 2;
  const ground = S * 0.92;
  const sz = mt.size || 3;
  const bulk = clamp(0.74 + sz / 18, 0.74, 1.5);
  const heavy = clamp(((mt.baseStrength || 50) + (mt.baseDefense || 50)) / 200, 0.5, 1.35);
  const lean = clamp((mt.baseSpeed || 50) / 95, 0.55, 1.5);
  const arch = archetypeFor(mt, ckey, rng);
  const dir = rng.chance(0.5) ? 1 : -1;
  const g = { cx, ground, bulk, heavy, lean, pal, eyeGlow, rng };

  // Ground shadow
  ctx.fillStyle = "rgba(0,0,0,0.24)";
  ctx.beginPath();
  ctx.ellipse(cx, ground + 4, 30 * bulk, 7 * bulk, 0, 0, Math.PI * 2);
  ctx.fill();

  // Soft accent-tinted aura.
  const auraR = 56 * bulk;
  const aura = ctx.createRadialGradient(cx, ground - 38, 8, cx, ground - 38, auraR);
  aura.addColorStop(0, rgba(pal0.accent, 0.26));
  aura.addColorStop(0.5, rgba(pal0.accent, 0.10));
  aura.addColorStop(1, rgba(pal0.accent, 0));
  ctx.fillStyle = aura;
  ctx.beginPath(); ctx.arc(cx, ground - 38, auraR, 0, Math.PI * 2); ctx.fill();

  // Themed flair sits behind the body (flames/leaves/shards above; fins/rocks
  // to the sides). Anchored to THIS archetype's silhouette top so the flair hugs
  // the creature instead of floating at a fixed canvas height above low bodies.
  const fa = flairAnchor(arch, ground, bulk);
  drawThemeFeatures(ctx, ckey, pal0, rng, cx, fa.cy, fa.halfW, fa.cy - fa.top);

  // Draw the creature facing `dir` (mirror the whole rig for variety).
  ctx.save();
  if (dir < 0) { ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0); }
  let head;
  switch (arch) {
    case "raptor":     head = drawRaptor(ctx, g); break;
    case "saurian":    head = drawSaurian(ctx, g); break;
    case "leviathan":  head = drawLeviathan(ctx, g); break;
    case "arthropod":  head = drawArthropod(ctx, g); break;
    case "brute":      head = drawBrute(ctx, g); break;
    default:           head = drawBeast(ctx, g); break;
  }
  drawBattleMarks(ctx, pal, rng, mt, head.body);
  drawMenaceFace(ctx, pal, eyeGlow, head);
  ctx.restore();

  return c;
}

// ── Archetype silhouettes (all drawn facing right; mirrored by the caller) ──
// Each returns { x, y, r, front, body:{x,y,w,h} } describing where the face goes
// and the torso box used for scars/spots.

// Quadruped predator — wolf / big cat: low horizontal body, four legs, jaws,
// pointed ears, spiked dorsal ridge, lashing tail.
function drawBeast(ctx, g) {
  const { cx, ground, bulk, heavy, lean, pal, rng } = g;
  const cy = ground - 30 * bulk;
  const halfLen = clamp(26 * bulk * lean, 22, 40);
  const bodyR = 16 * bulk * clamp(heavy, 0.7, 1.3);
  const hipX = cx - halfLen * 0.7, shX = cx + halfLen * 0.6;
  const bone = pal.bone;

  // Far legs (behind, darker)
  fillLimb(ctx, pal, shX - 4, cy + bodyR * 0.3, shX - 6, ground, 4.5 * heavy, 3, true);
  fillLimb(ctx, pal, hipX + 2, cy + bodyR * 0.3, hipX, ground, 5 * heavy, 3.5, true);

  // Lashing tail
  fillLimb(ctx, pal, hipX, cy - bodyR * 0.2, hipX - 18, cy - bodyR * 1.4, 5, 1.5, true);

  // Torso
  paintBody(ctx, pal, cy - bodyR, cy + bodyR, () => {
    ctx.beginPath();
    ctx.moveTo(hipX - bodyR * 0.7, cy);
    ctx.bezierCurveTo(hipX - bodyR, cy - bodyR * 1.5, shX, cy - bodyR * 1.5, shX + bodyR * 0.7, cy - bodyR * 0.5);
    ctx.bezierCurveTo(shX + bodyR, cy + bodyR * 0.6, hipX, cy + bodyR * 1.35, hipX - bodyR * 0.7, cy);
    ctx.closePath();
  });

  // Dorsal spike ridge (menace)
  const ns = rng.int(4, 6);
  for (let i = 0; i < ns; i++) {
    const t = i / (ns - 1);
    const rx = hipX + (shX - hipX) * t;
    const ry = cy - bodyR * (1.1 + Math.sin(t * Math.PI) * 0.25);
    drawHorn(ctx, rx, ry, rx + 2, ry - rng.float(7, 12), 2.6, rgb(shade(pal.dark, -0.04)));
  }

  // Near legs (front)
  fillLimb(ctx, pal, shX, cy + bodyR * 0.4, shX + 2, ground, 5.5 * heavy, 3.5);
  fillLimb(ctx, pal, hipX + 6, cy + bodyR * 0.5, hipX + 7, ground, 6 * heavy, 4);
  drawClaws(ctx, shX + 2, ground, 3, 4, 3, rgb(bone));
  drawClaws(ctx, hipX + 7, ground, 3, 4, 3, rgb(bone));

  // Head + snout, low and forward
  const hx = shX + bodyR * 0.9, hy = cy - bodyR * 0.6, hr = bodyR * 0.8;
  paintBody(ctx, pal, hy - hr, hy + hr, () => {
    ctx.beginPath(); ctx.ellipse(hx, hy, hr, hr * 0.92, 0, 0, Math.PI * 2); ctx.closePath();
  });
  // Snout
  paintBody(ctx, pal, hy, hy + hr, () => {
    ctx.beginPath();
    ctx.moveTo(hx + hr * 0.2, hy - hr * 0.4);
    ctx.lineTo(hx + hr * 1.5, hy + hr * 0.05);
    ctx.lineTo(hx + hr * 1.4, hy + hr * 0.6);
    ctx.lineTo(hx + hr * 0.1, hy + hr * 0.7);
    ctx.closePath();
  });
  // Pointed ears
  drawHorn(ctx, hx - hr * 0.2, hy - hr * 0.8, hx - hr * 0.7, hy - hr * 1.7, 3.5, rgb(shade(pal.base, -0.04)));
  drawHorn(ctx, hx + hr * 0.4, hy - hr * 0.85, hx + hr * 0.5, hy - hr * 1.7, 3.5, rgb(shade(pal.base, -0.04)));
  // Fangs at the snout tip
  drawMaw(ctx, hx + hr * 1.15, hy + hr * 0.32, hr * 0.34, hr * 0.2, bone);

  return { x: hx + hr * 0.1, y: hy - hr * 0.18, r: hr * 0.62, front: false,
           body: { x: cx - 2, y: cy, w: halfLen * 1.4, h: bodyR * 2 } };
}

// Bird of prey — upright raptor: hooked beak, fanned wings, crest, taloned feet.
function drawRaptor(ctx, g) {
  const { cx, ground, bulk, lean, pal, rng } = g;
  const cy = ground - 40 * bulk;
  const bodyW = 14 * bulk, bodyH = 24 * bulk * clamp(lean, 0.8, 1.3);
  const bone = pal.bone;

  // Spread wings behind the body (jagged trailing feathers)
  for (const s of [-1, 1]) {
    const far = s < 0;
    ctx.fillStyle = rgb(shade(far ? pal.dark : pal.base, far ? -0.05 : -0.02));
    ctx.strokeStyle = rgb(shade(pal.dark, -0.10)); ctx.lineWidth = 2; ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(cx + s * bodyW * 0.6, cy - bodyH * 0.4);
    ctx.quadraticCurveTo(cx + s * (26 + 14 * bulk), cy - bodyH * 1.1, cx + s * (30 + 16 * bulk), cy + bodyH * 0.1);
    for (let i = 0; i < 4; i++) {
      const t = 1 - i / 4;
      ctx.lineTo(cx + s * (10 + 20 * bulk * t), cy + bodyH * (0.1 + i * 0.12));
      ctx.lineTo(cx + s * (16 + 20 * bulk * t), cy + bodyH * (0.16 + i * 0.12));
    }
    ctx.lineTo(cx + s * bodyW * 0.5, cy + bodyH * 0.3);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  // Taloned legs
  fillLimb(ctx, pal, cx - 5, cy + bodyH * 0.6, cx - 6, ground, 3, 2.5);
  fillLimb(ctx, pal, cx + 5, cy + bodyH * 0.6, cx + 6, ground, 3, 2.5);
  drawClaws(ctx, cx - 6, ground, 3, 4, 3.5, rgb(bone));
  drawClaws(ctx, cx + 6, ground, 3, 4, 3.5, rgb(bone));

  // Upright body
  paintBody(ctx, pal, cy - bodyH, cy + bodyH, () => {
    ctx.beginPath(); ctx.ellipse(cx, cy, bodyW, bodyH, 0, 0, Math.PI * 2); ctx.closePath();
  });
  // Chest feather ruffle
  ctx.strokeStyle = rgba(pal.accent, 0.3); ctx.lineWidth = 1.4;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy - bodyH * 0.1 + i * 6, bodyW * (0.7 - i * 0.12), Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }

  // Head + hooked beak + crest
  const hx = cx, hy = cy - bodyH * 0.95, hr = bodyW * 1.05;
  paintBody(ctx, pal, hy - hr, hy + hr, () => {
    ctx.beginPath(); ctx.ellipse(hx, hy, hr, hr, 0, 0, Math.PI * 2); ctx.closePath();
  });
  // Crest spikes
  for (let i = -1; i <= 1; i++)
    drawHorn(ctx, hx + i * hr * 0.4, hy - hr * 0.7, hx + i * hr * 0.4 + i * 3, hy - hr * (1.5 + rng.float(0, 0.4)), 2.4, rgb(shade(pal.dark, -0.04)));
  // Hooked beak (bone)
  ctx.fillStyle = rgb(bone);
  ctx.beginPath();
  ctx.moveTo(hx + hr * 0.5, hy - hr * 0.2);
  ctx.lineTo(hx + hr * 1.5, hy + hr * 0.15);
  ctx.quadraticCurveTo(hx + hr * 1.3, hy + hr * 0.55, hx + hr * 0.5, hy + hr * 0.4);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = rgb(shade(pal.dark, -0.1)); ctx.lineWidth = 1; ctx.stroke();

  return { x: hx, y: hy - hr * 0.1, r: hr * 0.62, front: true,
           body: { x: cx, y: cy, w: bodyW * 2, h: bodyH * 1.6 } };
}

// Sprawling reptile / drake: long low body, splayed clawed limbs, long fanged
// snout, jagged dorsal plates, heavy tail.
function drawSaurian(ctx, g) {
  const { cx, ground, bulk, heavy, lean, pal, rng } = g;
  const cy = ground - 24 * bulk;
  const halfLen = clamp(28 * bulk * lean, 24, 42);
  const bodyR = 13 * bulk * clamp(heavy, 0.8, 1.3);
  const tailX = cx - halfLen * 0.8, headX = cx + halfLen * 0.7;
  const bone = pal.bone;

  // Far splayed legs
  fillLimb(ctx, pal, headX - 8, cy + bodyR * 0.5, headX - 12, ground, 4, 2.5, true);
  fillLimb(ctx, pal, tailX + 8, cy + bodyR * 0.5, tailX + 4, ground, 4.5, 2.5, true);

  // Long heavy tail
  fillLimb(ctx, pal, tailX + bodyR, cy, tailX - 16, cy + bodyR * 0.4, 7, 1.5);

  // Low body
  paintBody(ctx, pal, cy - bodyR, cy + bodyR, () => {
    ctx.beginPath();
    ctx.moveTo(tailX, cy);
    ctx.bezierCurveTo(tailX, cy - bodyR * 1.4, headX, cy - bodyR * 1.3, headX + bodyR, cy - bodyR * 0.2);
    ctx.bezierCurveTo(headX + bodyR, cy + bodyR * 0.9, tailX, cy + bodyR * 1.2, tailX, cy);
    ctx.closePath();
  });

  // Jagged dorsal plates
  const np = rng.int(5, 8);
  ctx.fillStyle = rgb(shade(pal.dark, -0.05));
  for (let i = 0; i < np; i++) {
    const t = i / (np - 1);
    const rx = tailX + (headX - tailX) * t;
    const ry = cy - bodyR * (1.05 + Math.sin(t * Math.PI) * 0.3);
    const ph = rng.float(6, 13) * Math.sin(t * Math.PI + 0.4);
    ctx.beginPath();
    ctx.moveTo(rx - 4, ry + 2); ctx.lineTo(rx, ry - ph); ctx.lineTo(rx + 4, ry + 2);
    ctx.closePath(); ctx.fill();
  }

  // Near splayed legs + claws
  fillLimb(ctx, pal, headX - 4, cy + bodyR * 0.7, headX - 7, ground, 5, 3);
  fillLimb(ctx, pal, tailX + 12, cy + bodyR * 0.7, tailX + 9, ground, 5.5, 3);
  drawClaws(ctx, headX - 7, ground, 3, 4.5, 3.5, rgb(bone));
  drawClaws(ctx, tailX + 9, ground, 3, 4.5, 3.5, rgb(bone));

  // Head + long snout
  const hx = headX + bodyR * 0.6, hy = cy - bodyR * 0.5, hr = bodyR * 0.85;
  paintBody(ctx, pal, hy - hr, hy + hr, () => {
    ctx.beginPath();
    ctx.moveTo(hx - hr, hy - hr * 0.5);
    ctx.lineTo(hx + hr * 2.2, hy - hr * 0.1);
    ctx.lineTo(hx + hr * 2.2, hy + hr * 0.5);
    ctx.lineTo(hx - hr * 0.6, hy + hr);
    ctx.closePath();
  });
  // Brow horn
  drawHorn(ctx, hx, hy - hr * 0.6, hx - hr * 0.4, hy - hr * 1.7, 2.8, rgb(shade(pal.dark, -0.05)));
  // Toothy jaw line (fangs along the snout)
  ctx.fillStyle = rgb(bone);
  for (let i = 0; i < 4; i++) {
    const fx = hx + hr * (0.5 + i * 0.45);
    ctx.beginPath();
    ctx.moveTo(fx - 1.6, hy + hr * 0.55); ctx.lineTo(fx + 1.6, hy + hr * 0.55);
    ctx.lineTo(fx, hy + hr * 0.55 + rng.float(4, 7));
    ctx.closePath(); ctx.fill();
  }

  return { x: hx + hr * 0.2, y: hy - hr * 0.15, r: hr * 0.6, front: false,
           body: { x: cx, y: cy, w: halfLen * 1.3, h: bodyR * 2 } };
}

// Finned leviathan — rearing sea-serpent: sinuous S-body, no legs, dorsal/side
// fins, a wide fanged maw and a fluked tail. Aquatic "weight."
function drawLeviathan(ctx, g) {
  const { cx, ground, bulk, lean, pal, rng } = g;
  const baseY = ground - 6;
  const topY = ground - 78 * bulk;
  const segW = 13 * bulk * clamp(lean, 0.7, 1.2);
  const bone = pal.bone;

  // Sinuous body as a thick wavy ribbon around a spine.
  const pts = [];
  const segs = 7;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = baseY + (topY - baseY) * t;
    const x = cx + Math.sin(t * Math.PI * 1.6 + 0.4) * 16 * (1 - t * 0.3);
    pts.push([x, y, segW * (0.6 + t * 0.7)]);
  }
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const [x, y, w] = pts[i];
    if (i === 0) ctx.moveTo(x - w, y); else ctx.lineTo(x - w, y);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const [x, y, w] = pts[i];
    ctx.lineTo(x + w, y);
  }
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, topY, 0, baseY);
  grad.addColorStop(0, rgb(shade(pal.base, 0.12)));
  grad.addColorStop(0.6, rgb(pal.base));
  grad.addColorStop(1, rgb(pal.dark));
  ctx.fillStyle = grad;
  ctx.strokeStyle = rgb(shade(pal.dark, -0.10)); ctx.lineWidth = 3; ctx.lineJoin = "round";
  ctx.fill(); ctx.stroke();

  // Tail fluke at the base
  ctx.fillStyle = rgb(shade(pal.accent, -0.04));
  const [bx, by] = pts[0];
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx - 16, by + 8); ctx.lineTo(bx - 6, by - 2);
  ctx.lineTo(bx + 6, by + 8); ctx.lineTo(bx + 18, by + 6);
  ctx.lineTo(bx + 4, by - 4);
  ctx.closePath(); ctx.fill();

  // Dorsal fin ridge along the spine
  ctx.fillStyle = rgba(shade(pal.accent, -0.02), 0.9);
  ctx.strokeStyle = rgb(pal.dark); ctx.lineWidth = 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y, w] = pts[i];
    ctx.beginPath();
    ctx.moveTo(x - w * 0.2, y); ctx.lineTo(x - 2, y - rng.float(7, 12)); ctx.lineTo(x + 3, y);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  // Side fins near the head
  const [hxBase, hyBase] = pts[pts.length - 1];
  ctx.fillStyle = rgba(shade(pal.accent, 0.02), 0.85);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(hxBase + s * segW * 0.6, hyBase + 14);
    ctx.quadraticCurveTo(hxBase + s * (segW + 18), hyBase + 6, hxBase + s * (segW + 6), hyBase + 26);
    ctx.closePath(); ctx.fill();
  }

  // Head with wide fanged maw
  const hr = segW * 1.25;
  const hx = hxBase, hy = topY + hr * 0.2;
  paintBody(ctx, pal, hy - hr, hy + hr, () => {
    ctx.beginPath(); ctx.ellipse(hx, hy, hr * 1.15, hr, 0, 0, Math.PI * 2); ctx.closePath();
  });
  // Frill horns swept back
  for (const s of [-1, 1])
    drawHorn(ctx, hx + s * hr * 0.7, hy - hr * 0.4, hx + s * hr * 1.4, hy - hr * 1.2, 3, rgb(shade(pal.dark, -0.04)));
  // Wide toothy maw
  drawMaw(ctx, hx, hy + hr * 0.45, hr * 0.7, hr * 0.34, bone);

  return { x: hx, y: hy - hr * 0.25, r: hr * 0.62, front: true,
           body: { x: cx, y: (topY + baseY) / 2, w: segW * 2.4, h: (baseY - topY) * 0.5 } };
}

// Segmented arthropod — spider / scorpion / beetle: domed carapace, many splayed
// legs, raised pincers + mandibles, optional stinger tail.
function drawArthropod(ctx, g) {
  const { cx, ground, bulk, heavy, pal, rng } = g;
  const cy = ground - 24 * bulk;
  const bodyW = 20 * bulk * clamp(heavy, 0.8, 1.3), bodyH = 13 * bulk;
  const bone = pal.bone;
  const legN = 3; // pairs

  // Splayed legs (far + near) radiating from the thorax
  for (const s of [-1, 1]) {
    for (let i = 0; i < legN; i++) {
      const t = i / (legN - 1);
      const ax = cx + s * bodyW * (0.3 + t * 0.5);
      const ay = cy - bodyH * 0.1;
      const kneeX = ax + s * (10 + i * 3);
      const kneeY = ay - 8 - i * 2;
      const footX = kneeX + s * (4 + i * 2);
      fillLimb(ctx, pal, ax, ay, kneeX, kneeY, 2.6, 2, s < 0);
      fillLimb(ctx, pal, kneeX, kneeY, footX, ground, 2, 1.4, s < 0);
    }
  }

  // Optional segmented stinger tail (scorpion) arching over the back
  if (rng.chance(0.5)) {
    let px = cx - bodyW * 0.7, py = cy - bodyH * 0.2;
    ctx.fillStyle = rgb(shade(pal.base, -0.02));
    ctx.strokeStyle = rgb(shade(pal.dark, -0.1)); ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const nx = px - 4 + i, ny = py - 9 - i;
      ctx.beginPath(); ctx.arc((px + nx) / 2, (py + ny) / 2, 4 - i * 0.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      px = nx; py = ny;
    }
    drawHorn(ctx, px, py, px + 6, py - 8, 2.5, rgb(bone)); // stinger
  }

  // Domed carapace (segmented)
  paintBody(ctx, pal, cy - bodyH, cy + bodyH, () => {
    ctx.beginPath(); ctx.ellipse(cx, cy, bodyW, bodyH, 0, 0, Math.PI * 2); ctx.closePath();
  });
  ctx.strokeStyle = rgba(pal.dark, 0.5); ctx.lineWidth = 1.4;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, bodyW * (0.35 + (i + 1) * 0.28), bodyH * 0.92, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
  }

  // Head + raised mandibles/pincers
  const hx = cx + bodyW * 0.85, hy = cy - bodyH * 0.2, hr = bodyH * 0.78;
  paintBody(ctx, pal, hy - hr, hy + hr, () => {
    ctx.beginPath(); ctx.ellipse(hx, hy, hr, hr * 0.9, 0, 0, Math.PI * 2); ctx.closePath();
  });
  // Mandibles (bone hooks)
  ctx.fillStyle = rgb(bone);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(hx + hr * 0.6, hy + s * hr * 0.1);
    ctx.quadraticCurveTo(hx + hr * 1.8, hy + s * hr * 0.6, hx + hr * 1.3, hy + s * hr * 1.0);
    ctx.quadraticCurveTo(hx + hr * 1.2, hy + s * hr * 0.4, hx + hr * 0.6, hy + s * hr * 0.4);
    ctx.closePath(); ctx.fill();
  }

  return { x: hx, y: hy, r: hr * 0.7, front: true,
           body: { x: cx, y: cy, w: bodyW * 1.6, h: bodyH * 1.6 } };
}

// Hulking brute — golem / ogre: massive shoulders & arms, sunken head, stubby
// legs, huge clawed fists, jagged horns. Maximum visual weight, front-facing.
function drawBrute(ctx, g) {
  const { cx, ground, bulk, heavy, pal, rng } = g;
  const w = 24 * bulk * clamp(heavy, 0.9, 1.4);
  const topY = ground - 76 * bulk;
  const shY = topY + 14 * bulk;
  const hipY = ground - 26 * bulk;
  const bone = pal.bone;

  // Stubby legs
  fillLimb(ctx, pal, cx - w * 0.45, hipY, cx - w * 0.5, ground, 8 * heavy, 7);
  fillLimb(ctx, pal, cx + w * 0.45, hipY, cx + w * 0.5, ground, 8 * heavy, 7);
  drawClaws(ctx, cx - w * 0.5, ground, 3, 4, 5, rgb(bone));
  drawClaws(ctx, cx + w * 0.5, ground, 3, 4, 5, rgb(bone));

  // Massive arms hanging to the ground, fists with claws
  for (const s of [-1, 1]) {
    const far = s < 0;
    const fistY = ground - 14;
    fillLimb(ctx, pal, cx + s * w * 0.85, shY, cx + s * (w * 1.05), fistY, 7 * heavy, 6, far);
    ctx.fillStyle = rgb(shade(far ? pal.dark : pal.base, far ? -0.05 : -0.02));
    ctx.strokeStyle = rgb(shade(pal.dark, -0.1)); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx + s * w * 1.05, fistY, 8 * heavy, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    drawClaws(ctx, cx + s * w * 1.05, fistY + 6 * heavy, 3, 5, 4, rgb(bone));
  }

  // Torso — broad trapezoid, wider at the shoulders
  paintBody(ctx, pal, topY, hipY + 8, () => {
    ctx.beginPath();
    ctx.moveTo(cx - w, shY - 6);
    ctx.quadraticCurveTo(cx, topY - 6, cx + w, shY - 6);
    ctx.lineTo(cx + w * 0.6, hipY + 8);
    ctx.quadraticCurveTo(cx, hipY + 16, cx - w * 0.6, hipY + 8);
    ctx.closePath();
  });
  // Cracked plating lines (golem weight)
  ctx.strokeStyle = rgba(pal.dark, 0.5); ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.5, shY + 6); ctx.lineTo(cx, shY + 18); ctx.lineTo(cx + w * 0.4, shY + 8);
  ctx.moveTo(cx, shY + 18); ctx.lineTo(cx, hipY); ctx.stroke();

  // Sunken head between the shoulders
  const hr = w * 0.45;
  const hx = cx, hy = shY - 4;
  paintBody(ctx, pal, hy - hr, hy + hr, () => {
    ctx.beginPath(); ctx.ellipse(hx, hy, hr, hr * 0.95, 0, 0, Math.PI * 2); ctx.closePath();
  });
  // Jagged horns
  for (const s of [-1, 1])
    drawHorn(ctx, hx + s * hr * 0.6, hy - hr * 0.5, hx + s * hr * 1.3, hy - hr * (1.4 + rng.float(0, 0.4)), 3.5, rgb(shade(pal.dark, -0.05)));
  // Heavy underbite jaw with tusks
  drawMaw(ctx, hx, hy + hr * 0.5, hr * 0.55, hr * 0.26, bone, true);

  return { x: hx, y: hy - hr * 0.1, r: hr * 0.62, front: true,
           body: { x: cx, y: (shY + hipY) / 2, w: w * 1.5, h: (hipY - shY) * 0.8 + 14 } };
}

function drawThemeFeatures(ctx, ckey, pal, rng, cx, cy, bodyW, bodyH) {
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

// ─── Player ───
// Simple top-down adventurer.
export function generatePlayerSprite() {
  // Static icon — a hooded, cloaked spirit-tamer holding a glowing spirit chain,
  // matching the animated drawCharacter and the concept art.
  const S = 64;
  // PV (task 39): render at RES× internal resolution and draw in the SAME 64-unit space
  // (ctx.scale), so the big menu previews (lobby / character-select) stay CRISP when
  // displayed near 1:1. Callers that show it large divide their display scale by RES.
  // In-game the player is the vector `drawCharacter`, not this sprite, so this is menu-only.
  const RES = 3;
  const c = makeCanvas(S * RES, S * RES);
  const ctx = c.getContext("2d");
  ctx.scale(RES, RES);
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

// ─── Canvas backdrops (shared recursive tree helper + the two generators below) ───
// Menu backdrop — shared atmospheric background for canvas menu scenes so they match the
// HTML title's standard (dark gradient + faint glow + spirit motes + gnarled corner trees +
// vignette); calm enough to keep UI readable. Combat arena backdrop (PV-T6) — atmospheric
// duel stage: dark violet field, a central spirit glow behind the VS, glowing platform pads
// under each combatant, side silhouettes, ground fog, motes and a vignette.
function canvasTree(ctx, x, y, ang, len, w, depth) {
  if (depth <= 0 || len < 7) return;
  const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
  ctx.strokeStyle = "#0a0714"; ctx.lineWidth = Math.max(1, w); ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
  const n = depth > 5 ? 2 : (Math.random() < 0.5 ? 2 : 3);
  for (let i = 0; i < n; i++) {
    const sp = i - (n - 1) / 2;
    const a = ang + sp * (0.3 + Math.random() * 0.3) + (Math.random() - 0.5) * 0.24;
    canvasTree(ctx, x2, y2, a, len * (0.72 + Math.random() * 0.12), w * 0.72, depth - 1);
  }
}
export function generateMenuBackground(w = 1280, h = 720) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d");
  // Almost-black NEUTRAL charcoal vertical gradient (no blue tint).
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgb(21,21,22)"); g.addColorStop(0.5, "rgb(12,12,12)"); g.addColorStop(1, "rgb(5,5,5)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // Faint EMBER glow up top (behind headings) — subtle so text stays readable.
  const gl = ctx.createRadialGradient(w / 2, h * 0.12, 0, w / 2, h * 0.12, h * 0.6);
  gl.addColorStop(0, "rgba(240,90,60,0.10)"); gl.addColorStop(1, "rgba(240,90,60,0)");
  ctx.fillStyle = gl; ctx.fillRect(0, 0, w, h);
  // Gnarled trees in the bottom corners (thick, dark — matches the title forest).
  canvasTree(ctx, w * 0.05, h + 8, -Math.PI / 2 + 0.16, h * 0.2, 30, 8);
  canvasTree(ctx, w * 0.95, h + 8, -Math.PI / 2 - 0.16, h * 0.2, 30, 8);
  canvasTree(ctx, w * 0.16, h + 8, -Math.PI / 2 + 0.08, h * 0.15, 20, 7);
  canvasTree(ctx, w * 0.84, h + 8, -Math.PI / 2 - 0.08, h * 0.15, 20, 7);
  // Ember spirit-motes (warm, drifting embers).
  const rng = rngFor("menu-bg");
  for (let i = 0; i < 70; i++) {
    const x = rng.float(0, w), y = rng.float(0, h), r = rng.float(0.6, 1.8);
    ctx.fillStyle = `rgba(255,180,130,${rng.float(0.05, 0.3)})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // Vignette.
  const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.34, w / 2, h / 2, h * 0.9);
  vg.addColorStop(0, "rgba(4,3,7,0)"); vg.addColorStop(1, "rgba(3,3,5,0.8)");
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  return c;
}

export function generateCombatBackground(w = 1280, h = 720) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d");

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgb(14, 11, 22)");
  g.addColorStop(0.5, "rgb(18, 16, 28)");
  g.addColorStop(1, "rgb(8, 7, 14)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  // Central spirit glow behind the VS divider.
  const cg = ctx.createRadialGradient(w / 2, h * 0.26, 0, w / 2, h * 0.26, 380);
  cg.addColorStop(0, "rgba(70,230,198,0.16)");
  cg.addColorStop(1, "rgba(70,230,198,0)");
  ctx.fillStyle = cg; ctx.fillRect(0, 0, w, h);

  // Dark silhouettes framing the arena (gnarled columns).
  ctx.strokeStyle = "rgb(9,8,15)"; ctx.lineCap = "round"; ctx.lineWidth = 60;
  for (const [bx, dir] of [[w * 0.05, 1], [w * 0.95, -1]]) {
    ctx.beginPath(); ctx.moveTo(bx, h);
    ctx.quadraticCurveTo(bx + dir * 24, h * 0.5, bx + dir * 58, h * 0.18); ctx.stroke();
  }

  // Glowing platform pads under the two combatants (left/right, ~y 250).
  for (const ppx of [w * 0.25, w * 0.75]) {
    const pg = ctx.createRadialGradient(ppx, 252, 0, ppx, 252, 150);
    pg.addColorStop(0, "rgba(120,205,210,0.13)");
    pg.addColorStop(1, "rgba(120,205,210,0)");
    ctx.fillStyle = pg; ctx.beginPath(); ctx.ellipse(ppx, 252, 150, 46, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(120,215,200,0.22)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(ppx, 260, 96, 24, 0, 0, Math.PI * 2); ctx.stroke();
  }

  // Ground fog + spirit motes.
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = `rgba(80,200,170,${0.05 - i * 0.012})`;
    ctx.fillRect(0, h * 0.52 + i * 20, w, 16);
  }
  const rng = rngFor("combat-bg");
  for (let i = 0; i < 90; i++) {
    const mx = rng.float(0, w), my = rng.float(0, h * 0.7);
    ctx.fillStyle = `rgba(150,255,230,${rng.float(0.04, 0.3)})`;
    ctx.beginPath(); ctx.arc(mx, my, rng.float(0.5, 1.6), 0, Math.PI * 2); ctx.fill();
  }

  // Vignette.
  const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.85);
  vg.addColorStop(0, "rgba(6,5,12,0)");
  vg.addColorStop(1, "rgba(5,4,10,0.7)");
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);

  return c;
}

