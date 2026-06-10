// Animated player character drawn entirely with Kaboom/shim primitives — no
// static sprite. Each cosmetic skin picks a BODY MODEL (silhouette) — not just a
// recolour — so the roster reads as genuinely different tamers: a hooded cloak, a
// plumed knight, a tall-hatted mage, a boxy automaton, a legless floating wisp.
// They all share the ground shadow + the held spirit-chain ring (the game's
// signature) so they still read as "a tamer". Call inside onDraw().
//
//   x, y     world position (feet/ground point)
//   t        animation clock (use k.time()) — sway, bob, glow shimmer
//   moving   true while walking
//   color    accent RGB for rim-light + spirit-chain glow — distinguishes players
//            (self vs others); the body base stays dark/dusky for everyone
//   dir      facing {x,y}; mirrors L/R, shows the face/eyes only when facing the
//            camera (down/side/idle), otherwise we see it from behind/side.
//   model    body silhouette id — "cloak" (default) | "knight" | "mage" |
//            "automaton" | "wisp". Unknown ids fall back to "cloak".
import { drawChainSkin, getEquippedSkin } from "./chainCosmetics.js";
import { prefersReducedMotion } from "../systems/a11y.js";

const lighten = (c, f = 1.6, add = 18) => c.map((v) => Math.min(255, Math.round(v * f) + add));

// ── Body models ──────────────────────────────────────────────────────────────
// Each receives a prepared params object P with the shared transform/animation
// values + the colour helper C. They draw ONLY the body (between the shadow and
// the held chain ring, both painted by drawCharacter around them).

// The original hooded, cloaked spirit-tamer (back-facing by default, like the
// concept art). This is the default and must stay visually identical to before.
function cloakModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cx, cy, ucx, ucy, fxu, facingCamera, hemSway } = P;
  // Lower cloak (wide, tapered) with a tattered, swaying hem.
  k.drawEllipse({ pos: k.vec2(cx, cy + 6 * s), radiusX: 13 * s, radiusY: 16 * s, color: C(...cloak) });
  for (let i = -2; i <= 2; i++) {
    const hh = (5 + (Math.abs(i) % 2) * 4 + (i === 0 ? 3 : 0)) * s;
    k.drawRect({ pos: k.vec2(cx + i * 5 * s + hemSway * 0.4, cy + 18 * s), width: 4.5 * s, height: hh,
      color: C(...cloakDk), anchor: "center", radius: 1 * s });
  }
  // Upper cloak / shoulders, with a cool rim light down one edge.
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 6 * s), radiusX: 10 * s, radiusY: 11 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(fxu(-7), ucy - 4 * s), radiusX: 3 * s, radiusY: 12 * s, color: C(...accent), opacity: 0.28 });
  // Pointed hood / cowl.
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 15 * s), radiusX: 9 * s, radiusY: 10 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 20 * s), radiusX: 5.5 * s, radiusY: 6 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(fxu(-4), ucy - 16 * s), radiusX: 2.4 * s, radiusY: 7 * s, color: C(...accent), opacity: 0.24 });
  if (facingCamera) {
    // Shadowed face opening with two faint glowing eyes.
    k.drawEllipse({ pos: k.vec2(ucx, ucy - 14 * s), radiusX: 5.5 * s, radiusY: 6.5 * s, color: C(...cloakDk) });
    eyes(P, 2.2, ucy - 14 * s, 1.4);
  }
}

// Heavy plate armour: broad pauldrons, a breastplate, a visored helm with a
// backward-swept crest. Boxy and wide-shouldered — the opposite of the cloak.
function knightModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cx, cy, ucx, ucy, fxu, flip, facingCamera, t, reduce } = P;
  const plate = lighten(cloak, 1.7, 22);
  // Greaves (two armoured legs).
  k.drawRect({ pos: k.vec2(fxu(-4), cy + 13 * s), width: 5 * s, height: 12 * s, color: C(...cloakDk), anchor: "center", radius: 1.5 * s });
  k.drawRect({ pos: k.vec2(fxu(4), cy + 13 * s), width: 5 * s, height: 12 * s, color: C(...cloakDk), anchor: "center", radius: 1.5 * s });
  // Tassets / armoured skirt.
  k.drawEllipse({ pos: k.vec2(cx, cy + 6 * s), radiusX: 11 * s, radiusY: 13 * s, color: C(...cloak) });
  // Breastplate (a rounded box with a centre ridge + edge rim-light).
  k.drawRect({ pos: k.vec2(ucx, ucy - 4 * s), width: 18 * s, height: 18 * s, color: C(...plate), anchor: "center", radius: 5 * s });
  k.drawRect({ pos: k.vec2(ucx, ucy - 4 * s), width: 2 * s, height: 14 * s, color: C(...cloakDk), anchor: "center", radius: 1 * s });
  k.drawEllipse({ pos: k.vec2(fxu(-8), ucy - 4 * s), radiusX: 2.4 * s, radiusY: 9 * s, color: C(...accent), opacity: 0.3 });
  // Pauldrons — the broad-shoulder signature.
  k.drawEllipse({ pos: k.vec2(fxu(-10), ucy - 7 * s), radiusX: 5 * s, radiusY: 4.5 * s, color: C(...plate) });
  k.drawEllipse({ pos: k.vec2(fxu(10), ucy - 7 * s), radiusX: 5 * s, radiusY: 4.5 * s, color: C(...plate) });
  k.drawEllipse({ pos: k.vec2(fxu(-10), ucy - 8.5 * s), radiusX: 5 * s, radiusY: 1.6 * s, color: C(...accent), opacity: 0.4 });
  // Helm (dome + jaw guard).
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 16 * s), radiusX: 7 * s, radiusY: 8 * s, color: C(...plate) });
  k.drawRect({ pos: k.vec2(ucx, ucy - 13 * s), width: 12 * s, height: 6 * s, color: C(...plate), anchor: "center", radius: 2 * s });
  // Backward-swept crest/plume.
  const crestSway = reduce ? 0 : Math.sin(t * 3) * 0.8;
  for (let i = 0; i < 4; i++) {
    k.drawEllipse({ pos: k.vec2(ucx - flip * (i * 1.4 + crestSway) * s, ucy - 23 * s + i * 1.6 * s),
      radiusX: 2.2 * s, radiusY: (3 - i * 0.3) * s, color: C(...accent), opacity: 0.85 });
  }
  if (facingCamera) {
    // Dark visor slit with glowing eyes behind it.
    k.drawRect({ pos: k.vec2(ucx, ucy - 15 * s), width: 11 * s, height: 3.2 * s, color: C(...cloakDk), anchor: "center", radius: 1.5 * s });
    eyes(P, 2.6, ucy - 15 * s, 1.2);
  }
}

// Slender arcane mage: a long tapered robe, narrow shoulders, and a tall pointed
// hat (a leaning cone) with a brim and a sparkling tip — a totally vertical read.
function mageModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cx, cy, ucx, ucy, fxu, flip, facingCamera, hemSway, t, reduce } = P;
  // Long slender robe with a pointier hem.
  k.drawEllipse({ pos: k.vec2(cx, cy + 7 * s), radiusX: 10 * s, radiusY: 16 * s, color: C(...cloak) });
  for (let i = -2; i <= 2; i++) {
    const hh = (7 + (i === 0 ? 4 : 0)) * s;
    k.drawRect({ pos: k.vec2(cx + i * 4.4 * s + hemSway * 0.4, cy + 19 * s), width: 3.4 * s, height: hh,
      color: C(...cloakDk), anchor: "center", radius: 1 * s });
  }
  // Narrow upper body + a shoulder rim-light.
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 4 * s), radiusX: 7 * s, radiusY: 10 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(fxu(-5), ucy - 3 * s), radiusX: 2.2 * s, radiusY: 8 * s, color: C(...accent), opacity: 0.26 });
  // Head.
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 15 * s), radiusX: 5 * s, radiusY: 5.5 * s, color: C(...cloak) });
  // Wide hat brim.
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 18 * s), radiusX: 11 * s, radiusY: 3 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 18.8 * s), radiusX: 11 * s, radiusY: 1.2 * s, color: C(...accent), opacity: 0.3 });
  // Tall pointed cone, leaning into the heading + a soft sway near the tip.
  const tipLean = flip * 2.4;
  let tipX = ucx, tipY = ucy - 19 * s;
  for (let i = 0; i < 7; i++) {
    const f = i / 6;
    const sway = reduce ? 0 : Math.sin(t * 2 + f * 2) * f * 1.2;
    tipX = ucx + (tipLean * f + sway) * s;
    tipY = ucy - 19 * s - i * 2.7 * s;
    k.drawEllipse({ pos: k.vec2(tipX, tipY), radiusX: (6.6 - 5.6 * f) * s, radiusY: 2.6 * s, color: C(...cloak) });
  }
  // Accent band + a sparkling tip star.
  k.drawEllipse({ pos: k.vec2(ucx + tipLean * 0.45 * s, ucy - 26 * s), radiusX: 3.4 * s, radiusY: 1.6 * s, color: C(...accent), opacity: 0.55 });
  const twinkle = reduce ? 0.85 : 0.55 + 0.4 * Math.sin(t * 4);
  k.drawCircle({ pos: k.vec2(tipX, tipY), radius: 2.6 * s, color: C(...accent), opacity: 0.3 });
  k.drawCircle({ pos: k.vec2(tipX, tipY), radius: 1.4 * s, color: C(...accent), opacity: twinkle });
  if (facingCamera) {
    k.drawEllipse({ pos: k.vec2(ucx, ucy - 13 * s), radiusX: 4.6 * s, radiusY: 4.6 * s, color: C(...cloakDk) });
    eyes(P, 2.0, ucy - 13 * s, 1.3);
  }
}

// Mechanical automaton: blocky chassis with a pulsing core, square shoulders, a
// rectangular head with a single visor bar, and an antenna with a blinking tip.
function automatonModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cy, ucx, ucy, fxu, flip, facingCamera, t, reduce } = P;
  const panel = lighten(cloak, 1.4, 14);
  // Blocky legs.
  k.drawRect({ pos: k.vec2(fxu(-4), cy + 13 * s), width: 5 * s, height: 11 * s, color: C(...cloakDk), anchor: "center", radius: 1 * s });
  k.drawRect({ pos: k.vec2(fxu(4), cy + 13 * s), width: 5 * s, height: 11 * s, color: C(...cloakDk), anchor: "center", radius: 1 * s });
  // Chassis (torso box) + panel seam.
  k.drawRect({ pos: k.vec2(ucx, cy + 2 * s), width: 20 * s, height: 21 * s, color: C(...cloak), anchor: "center", radius: 4 * s });
  k.drawRect({ pos: k.vec2(ucx, cy - 6 * s), width: 16 * s, height: 1.5 * s, color: C(...cloakDk), anchor: "center" });
  k.drawRect({ pos: k.vec2(fxu(-9), cy + 2 * s), width: 1.5 * s, height: 16 * s, color: C(...cloakDk), anchor: "center" });
  // Pulsing reactor core.
  const pulse = reduce ? 0.7 : 0.5 + 0.35 * Math.sin(t * 3);
  k.drawCircle({ pos: k.vec2(ucx, cy + 2 * s), radius: 5 * s, color: C(...accent), opacity: 0.22 });
  k.drawCircle({ pos: k.vec2(ucx, cy + 2 * s), radius: 2.4 * s, color: C(...accent), opacity: pulse });
  // Square shoulder blocks.
  k.drawRect({ pos: k.vec2(fxu(-11), ucy - 6 * s), width: 5 * s, height: 6 * s, color: C(...panel), anchor: "center", radius: 1.5 * s });
  k.drawRect({ pos: k.vec2(fxu(11), ucy - 6 * s), width: 5 * s, height: 6 * s, color: C(...panel), anchor: "center", radius: 1.5 * s });
  // Rectangular head.
  k.drawRect({ pos: k.vec2(ucx, ucy - 15 * s), width: 13 * s, height: 11 * s, color: C(...panel), anchor: "center", radius: 3 * s });
  // Antenna with a blinking tip.
  k.drawLine({ p1: k.vec2(ucx, ucy - 20 * s), p2: k.vec2(ucx + flip * 2 * s, ucy - 26 * s), width: 1.5 * s, color: C(...cloakDk) });
  k.drawCircle({ pos: k.vec2(ucx + flip * 2 * s, ucy - 26 * s), radius: 2 * s, color: C(...accent), opacity: reduce ? 0.8 : 0.55 + 0.45 * Math.sin(t * 4.5) });
  if (facingCamera) {
    // Single wide visor bar (cyclopean), glowing.
    k.drawRect({ pos: k.vec2(ucx, ucy - 15 * s), width: 10 * s, height: 4 * s, color: C(...cloakDk), anchor: "center", radius: 1.5 * s });
    k.drawRect({ pos: k.vec2(ucx, ucy - 15 * s), width: 8 * s, height: 2.2 * s, color: C(...accent), anchor: "center", radius: 1 * s, opacity: 0.35 });
    k.drawRect({ pos: k.vec2(ucx, ucy - 15 * s), width: 7 * s, height: 1.4 * s, color: C(...accent), anchor: "center", radius: 0.7 * s });
  } else {
    k.drawRect({ pos: k.vec2(ucx, ucy - 16 * s), width: 9 * s, height: 1.4 * s, color: C(...cloakDk), anchor: "center", radius: 0.7 * s });
  }
}

// Legless spectral wisp: a floating teardrop body with a glowing aura, trailing
// flame-tails instead of legs, and small flame crests — it hovers, never walks.
function wispModel(P) {
  const { k, C, s, accent, cloak, cy, ucx, ucy, fxu, facingCamera, t, reduce } = P;
  // Aura halo.
  [[13, 0.10], [9, 0.18]].forEach(([r, o]) =>
    k.drawCircle({ pos: k.vec2(ucx, ucy - 2 * s), radius: r * s, color: C(...accent), opacity: o }));
  // Trailing flame-tails (sway like fire) where legs/hem would be.
  for (let i = -1; i <= 1; i++) {
    const sway = (reduce ? 0 : Math.sin(t * 3 + i * 1.3)) * 2 * s;
    k.drawEllipse({ pos: k.vec2(ucx + i * 4 * s + sway, cy + 11 * s), radiusX: 2.6 * s, radiusY: 6 * s, color: C(...cloak) });
    k.drawEllipse({ pos: k.vec2(ucx + i * 4 * s + sway, cy + 14 * s), radiusX: 1.4 * s, radiusY: 3 * s, color: C(...accent), opacity: 0.4 });
  }
  // Teardrop body + rim-light.
  k.drawEllipse({ pos: k.vec2(ucx, cy + 1 * s), radiusX: 8 * s, radiusY: 11 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(fxu(-5), cy + 1 * s), radiusX: 2.4 * s, radiusY: 7 * s, color: C(...accent), opacity: 0.3 });
  // Head merges into the body.
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 11 * s), radiusX: 6 * s, radiusY: 6.5 * s, color: C(...cloak) });
  // Two flame crests rising from the crown.
  const crest = reduce ? 0 : Math.sin(t * 4) * 0.6;
  k.drawEllipse({ pos: k.vec2(fxu(-3), ucy - 18 * s - crest * s), radiusX: 1.6 * s, radiusY: 4 * s, color: C(...accent), opacity: 0.5 });
  k.drawEllipse({ pos: k.vec2(fxu(3), ucy - 18 * s + crest * s), radiusX: 1.6 * s, radiusY: 4 * s, color: C(...accent), opacity: 0.5 });
  if (facingCamera) eyes(P, 2.2, ucy - 11 * s, 1.5);
}

// Two glowing eyes (soft halo + bright core), accent-tinted — shared by models.
function eyes(P, half, eyeY, coreR) {
  const { k, C, s, accent, fxu } = P;
  k.drawCircle({ pos: k.vec2(fxu(-half), eyeY), radius: 3 * s, color: C(...accent), opacity: 0.3 });
  k.drawCircle({ pos: k.vec2(fxu(half), eyeY), radius: 3 * s, color: C(...accent), opacity: 0.3 });
  k.drawCircle({ pos: k.vec2(fxu(-half), eyeY), radius: coreR * s, color: C(...accent) });
  k.drawCircle({ pos: k.vec2(fxu(half), eyeY), radius: coreR * s, color: C(...accent) });
}

const MODELS = { cloak: cloakModel, knight: knightModel, mage: mageModel, automaton: automatonModel, wisp: wispModel };
export const CHARACTER_MODELS = Object.keys(MODELS);

export function drawCharacter(k, { x, y, t = 0, moving = false, color = [90, 170, 255], dir = null, skin = null, cloak: cloakIn = null, scale = 1, model = "cloak" }) {
  const C = (r, g, b) => k.rgb(r, g, b);
  const s = scale > 0 ? scale : 1; // uniform scale (lobby/menu previews draw the SAME vector large + crisp)
  const accent = color;
  const cloak = cloakIn || [24, 21, 34];          // dusky base (cosmetic-tintable)
  const cloakDk = cloak.map((v) => Math.round(v * 0.6)); // shadowed folds / hem / seams
  const dx = dir ? dir.x : 0;
  const dy = dir ? dir.y : 1;
  const flip = dx < -0.15 ? -1 : 1;
  // Face the camera (show the face + eyes) unless walking clearly AWAY (upward): so
  // down, SIDEWAYS, and idle all face the player — only walking up shows the back.
  const facingCamera = !(dy < -0.4 && Math.abs(dy) >= Math.abs(dx));

  // a11y: under "reduce motion" freeze the decorative bob / step / sway to a static
  // pose (position still conveys movement) — vestibular comfort.
  const reduce = prefersReducedMotion();
  const idle = reduce ? 0 : Math.sin(t * 2.4) * 1.0;
  const step = (moving && !reduce) ? Math.sin(t * 11) : 0;
  const bob = (reduce ? 0 : (moving ? Math.abs(Math.sin(t * 11)) * 2.2 : idle)) * s;
  const hemSway = (reduce ? 0 : (moving ? Math.sin(t * 11) * 2 : Math.sin(t * 1.8) * 1.0) * flip) * s;
  const cx = x;
  const cy = y - bob;
  const fx = (o) => cx + o * flip * s;
  // PV-T14 "richer motion": while walking, the upper body leans into the heading for
  // a sense of momentum, while the lower body + feet stay planted.
  const lean = (v, a) => ((moving && !reduce) ? Math.max(-1, Math.min(1, v)) * a * s : 0);
  const ucx = cx + lean(dx, 2.6);
  const ucy = cy + lean(dy, 1.2);
  const fxu = (o) => ucx + o * flip * s;

  // Ground shadow.
  k.drawEllipse({ pos: k.vec2(x, y + 15 * s), radiusX: 13 * s, radiusY: 4 * s, color: C(0, 0, 0), opacity: 0.3 });

  // Body silhouette (per equipped skin model — unknown ids fall back to the cloak).
  const P = { k, C, s, accent, cloak, cloakDk, cx, cy, ucx, ucy, fx, fxu, flip, facingCamera, reduce, t, moving, step, hemSway, idle, dx, dy };
  (MODELS[model] || cloakModel)(P);

  // Spirit-chain ring held out to the side — the player's equipped cosmetic skin.
  // Shared across ALL models (every tamer holds one — the game's signature).
  const rx = fxu(15);
  const ry = ucy + 2 * s + (reduce ? 0 : (moving ? Math.abs(step) * 1.5 : Math.sin(t * 2.4)) * s);
  k.drawLine({ p1: k.vec2(fxu(7), ucy - 1 * s), p2: k.vec2(rx, ry), width: 4 * s, color: C(...cloak) }); // sleeve/arm tether
  // CN-12: render THIS character's chain skin (rivals pass their own); default to the
  // local player's equipped skin. a11y: freeze the ring shimmer under reduce-motion.
  drawChainSkin(k, { x: rx, y: ry, r: 7 * s, t: reduce ? 0 : t, skin: skin || getEquippedSkin() });
}
