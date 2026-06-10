// Pokémon-style battle stage + entry cinematic (user request 2026-06-10:
// "a battle screen like in pokemon games … a nice transition … the player throws
// the spirit chain, it opens up getting bigger + spinning faster, the monster
// spawns out of it").
//
// Pure kaboom-primitive draws (mirrors render/spiritchain.js / render/character.js):
// no new sprites, no tween engine — the whole cinematic is parametrized by a single
// `introElapsed` clock so it's deterministic and immediate-mode faithful. Everything
// is drawn `fixed:true` (screen space) inside the square play window, above the
// combat panel, so it sits over the (frozen) world the same way the panel does.
//
// Called from onlineGame's combat onDraw. Coordinates are design units.

import { THEME, elementColor } from "../ui/theme.js";

// ── Cinematic timeline (seconds, cumulative) ──────────────────────────────────
const WIPE_END    = 0.42; // transition blinds retract → stage revealed
const THROW_START = 0.52; // a beat after the wipe, the tamer releases the chain
const THROW_END   = 0.96; // chain finishes its arc to the enemy spot
const SPIN_END    = 1.78; // chain has grown + spun up to a blur
const SPAWN_END   = 2.34; // monster has fully burst out and settled
export const BATTLE_INTRO_DURATION = SPAWN_END;

const TWO_PI = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// Sub-progress of a [a,b] window given the master clock `e`.
const seg = (e, a, b) => clamp01((e - a) / (b - a));
const easeOut = (p) => 1 - (1 - p) * (1 - p);
const easeIn = (p) => p * p;
const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
// Overshoot landing (back-ease) for the monster pop.
const easeOutBack = (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];

// A monster sprite slug; falls back to an element-tinted blob if not loaded.
function drawCreature(k, slug, cx, cy, w, h, opacity, tint) {
  if (opacity <= 0 || w <= 0 || h <= 0) return;
  try {
    k.drawSprite({ sprite: slug, pos: k.vec2(cx, cy), anchor: "center", width: w, height: h, opacity, fixed: true });
  } catch {
    // Sprite not registered (a freeform AI monster) — a glowing element blob keeps
    // the stage from looking empty (mirrors the overworld fallback in onlineGame).
    k.drawCircle({ pos: k.vec2(cx, cy), radius: w * 0.42, color: k.rgb(tint[0], tint[1], tint[2]), opacity: 0.9 * opacity, fixed: true });
    k.drawCircle({ pos: k.vec2(cx - w * 0.13, cy - h * 0.08), radius: w * 0.07, color: k.rgb(255, 255, 255), opacity: 0.9 * opacity, fixed: true });
    k.drawCircle({ pos: k.vec2(cx + w * 0.13, cy - h * 0.08), radius: w * 0.07, color: k.rgb(255, 255, 255), opacity: 0.9 * opacity, fixed: true });
  }
}

// An oval "battle pad" the monster stands on (the signature Pokémon platform).
function drawPlatform(k, cx, cy, rx, ry, tint) {
  k.drawEllipse({ pos: k.vec2(cx, cy + ry * 0.5), radiusX: rx * 1.04, radiusY: ry * 1.05, color: k.rgb(0, 0, 0), opacity: 0.30, fixed: true }); // contact shadow
  k.drawEllipse({ pos: k.vec2(cx, cy), radiusX: rx, radiusY: ry, color: k.rgb(...mix(THEME.surface, tint, 0.18)), fixed: true });
  k.drawEllipse({ pos: k.vec2(cx, cy - ry * 0.18), radiusX: rx * 0.86, radiusY: ry * 0.74, color: k.rgb(...mix(THEME.surface2, tint, 0.22)), opacity: 0.9, fixed: true }); // top highlight
}

// The tamer, seen from behind, mid-throw. `armT` (0 windup→back, 1 swung forward)
// drives the throwing arm; returns the hand position so the chain launches from it.
function drawTamer(k, tx, ty, sz, armT, accent) {
  const cloak = mix(THEME.bgAlt, accent, 0.55);
  const skin = [222, 178, 140];
  k.drawEllipse({ pos: k.vec2(tx, ty), radiusX: sz * 0.42, radiusY: sz * 0.12, color: k.rgb(0, 0, 0), opacity: 0.30, fixed: true }); // ground shadow
  // legs
  for (const dx of [-0.18, 0.18]) k.drawRect({ pos: k.vec2(tx + dx * sz, ty - sz * 0.5), width: sz * 0.2, height: sz * 0.5, radius: sz * 0.08, color: k.rgb(...mix(cloak, [0, 0, 0], 0.35)), anchor: "top", fixed: true });
  // torso (back view: a tapered cloak)
  k.drawRect({ pos: k.vec2(tx, ty - sz * 0.5), width: sz * 0.72, height: sz * 0.82, radius: sz * 0.16, color: k.rgb(cloak[0], cloak[1], cloak[2]), anchor: "bot", fixed: true });
  k.drawRect({ pos: k.vec2(tx, ty - sz * 1.05), width: sz * 0.6, height: sz * 0.16, radius: sz * 0.06, color: k.rgb(accent[0], accent[1], accent[2]), anchor: "center", opacity: 0.85, fixed: true }); // shoulder accent band
  // head + a little hair
  const hx = tx, hy = ty - sz * 1.32;
  k.drawCircle({ pos: k.vec2(hx, hy), radius: sz * 0.27, color: k.rgb(skin[0], skin[1], skin[2]), fixed: true });
  k.drawCircle({ pos: k.vec2(hx, hy - sz * 0.06), radius: sz * 0.28, color: k.rgb(...mix([40, 30, 28], accent, 0.18)), opacity: 0.92, fixed: true });
  k.drawRect({ pos: k.vec2(hx, hy + sz * 0.04), width: sz * 0.5, height: sz * 0.22, radius: sz * 0.08, color: k.rgb(...mix([40, 30, 28], accent, 0.18)), anchor: "center", fixed: true });
  // throwing arm — swings from back (down-left) through to forward (up-right).
  const shoulder = k.vec2(tx + sz * 0.34, ty - sz * 1.0);
  const ang = lerp(2.5, -0.62, armT); // radians; screen y is down
  const armLen = sz * 0.82;
  const hand = k.vec2(shoulder.x + Math.cos(ang) * armLen, shoulder.y + Math.sin(ang) * armLen);
  const elbow = k.vec2(shoulder.x + Math.cos(ang) * armLen * 0.52, shoulder.y + Math.sin(ang) * armLen * 0.52);
  k.drawLine({ p1: shoulder, p2: elbow, width: sz * 0.2, color: k.rgb(cloak[0], cloak[1], cloak[2]), fixed: true });
  k.drawLine({ p1: elbow, p2: hand, width: sz * 0.17, color: k.rgb(skin[0], skin[1], skin[2]), fixed: true });
  k.drawCircle({ pos: hand, radius: sz * 0.1, color: k.rgb(skin[0], skin[1], skin[2]), fixed: true });
  return hand;
}

// The spirit-chain link ring (local copy so we fully control radius / spin / glow —
// render/spiritchain.js's is fixed-radius and world-space). `glow` brightens the core.
function drawChainRing(k, x, y, color, angle, radius, opacity, glow = 1) {
  if (opacity <= 0) return;
  const col = k.rgb(color[0], color[1], color[2]);
  const LINKS = 6;
  k.drawCircle({ pos: k.vec2(x, y), radius: radius * 1.7, color: col, opacity: 0.18 * opacity * glow, fixed: true }); // soft halo
  const pts = [];
  for (let i = 0; i < LINKS; i++) { const a = angle + (i / LINKS) * TWO_PI; pts.push(k.vec2(x + Math.cos(a) * radius, y + Math.sin(a) * radius)); }
  for (let i = 0; i < LINKS; i++) k.drawLine({ p1: pts[i], p2: pts[(i + 1) % LINKS], width: 2.4, color: col, opacity: 0.75 * opacity, fixed: true });
  for (const p of pts) k.drawCircle({ pos: p, radius: 4.6, color: col, opacity: 0.2 * opacity, fixed: true });
  for (const p of pts) k.drawCircle({ pos: p, radius: 2.6, color: col, opacity, fixed: true });
  // white-hot core, intensifying with the spin.
  k.drawCircle({ pos: k.vec2(x, y), radius: radius * 0.32 + 2, color: k.rgb(255, 255, 255), opacity: clamp01(0.25 + 0.7 * (glow - 1) * 0.5) * opacity, fixed: true });
}

/**
 * Draw the battle stage + (while `introElapsed < BATTLE_INTRO_DURATION`) the entry
 * cinematic. After the intro it settles to a static stage that the combat panel
 * sits beneath. Safe to call every combat frame.
 *
 * @param {object} k Kaboom/Phaser-shim context
 * @param {object} o
 * @param {{x:number,y:number,size:number,cx:number,right:number,bottom:number}} o.rect  square play window
 * @param {number} o.stageBottom  y where the combat panel begins (stage fills rect.y → here)
 * @param {object} o.enemy   c.enemy  (typeName, element)
 * @param {object} o.active  c.active (typeName, element)
 * @param {number[]} o.chainCol  equipped chain tint [r,g,b]
 * @param {number} o.time   k.time() — idle/spin clock
 * @param {number} o.introElapsed  seconds since this combat started
 * @param {boolean} o.reducedMotion  a11y: skip the cinematic, show the settled stage
 */
export function drawBattleStage(k, { rect, stageBottom, enemy, active, chainCol, time, introElapsed, reducedMotion }) {
  const sx = rect.x, sy = rect.y, sw = rect.size, sh = stageBottom - rect.y;
  if (sh <= 20) return; // no room (degenerate viewport) — let the panel stand alone
  // a11y: collapse the cinematic to its end state (no flashes / spin / fling).
  const e = reducedMotion ? BATTLE_INTRO_DURATION : Math.max(0, introElapsed);

  const ec = enemy ? elementColor(enemy.element) : THEME.primary;
  const hy = sy + sh * 0.54; // horizon

  // ── Backdrop ────────────────────────────────────────────────────────────────
  k.drawRect({ pos: k.vec2(sx, sy), width: sw, height: sh, color: k.rgb(...THEME.bg), fixed: true }); // opaque — hides the frozen world
  // Sky: vertical gradient bands, dark crown → element-tinted horizon glow.
  const skyTop = mix(THEME.bgAlt, ec, 0.05), skyHorizon = mix(THEME.bg, ec, 0.22);
  // Many thin bands → a smooth gradient. 10 left visible horizontal steps (banding) in
  // the backdrop; 48 makes each step ~a few px, still trivially cheap (flat fills).
  const BANDS = 48;
  for (let i = 0; i < BANDS; i++) {
    const t = i / (BANDS - 1), y0 = lerp(sy, hy, i / BANDS), bh = (hy - sy) / BANDS + 1;
    k.drawRect({ pos: k.vec2(sx, y0), width: sw, height: bh, color: k.rgb(...mix(skyTop, skyHorizon, t)), fixed: true });
  }
  // Focus glow behind the enemy spot.
  const ex = sx + sw * 0.72, ey = hy - sh * 0.05;
  k.drawCircle({ pos: k.vec2(ex, ey - sh * 0.04), radius: sw * 0.26, color: k.rgb(ec[0], ec[1], ec[2]), opacity: 0.12, fixed: true });
  // Ground.
  const groundFar = mix(THEME.surface, ec, 0.1), groundNear = mix(THEME.bgAlt, ec, 0.04);
  const GROUND_BANDS = 24; // was 6 — match the smoother sky so the ground doesn't step
  for (let i = 0; i < GROUND_BANDS; i++) {
    const t = i / (GROUND_BANDS - 1), y0 = lerp(hy, stageBottom, i / GROUND_BANDS), bh = (stageBottom - hy) / GROUND_BANDS + 1;
    k.drawRect({ pos: k.vec2(sx, y0), width: sw, height: bh, color: k.rgb(...mix(groundFar, groundNear, t)), fixed: true });
  }
  k.drawLine({ p1: k.vec2(sx, hy), p2: k.vec2(sx + sw, hy), width: 1.5, color: k.rgb(...mix(skyHorizon, ec, 0.4)), opacity: 0.5, fixed: true });

  // ── Platforms ─────────────────────────────────────────────────────────────
  const px = sx + sw * 0.34, py = stageBottom - sh * 0.13; // player monster spot
  drawPlatform(k, ex, ey, sw * 0.2, sw * 0.052, ec);
  drawPlatform(k, px, py, sw * 0.24, sw * 0.066, active ? elementColor(active.element) : THEME.primary);

  // Phase clocks.
  const wipeP = seg(e, 0, WIPE_END);
  const throwP = seg(e, THROW_START, THROW_END);
  const spinP = seg(e, THROW_END, SPIN_END);
  const spawnP = seg(e, SPIN_END, SPAWN_END);
  const idle = reducedMotion ? 0 : Math.sin(time * 2);

  // ── Player's active monster (fades + settles in during the reveal) ──────────
  if (active) {
    const inP = easeOut(seg(e, 0.1, 0.6));
    const aSlug = String(active.typeName || "").toLowerCase().replace(/\s+/g, "_");
    const aw = sw * 0.3, ah = aw;
    const acy = py - ah * 0.34 + (1 - inP) * 24 + idle * 2;
    drawCreature(k, aSlug, px, acy, aw, ah, inP, active ? elementColor(active.element) : THEME.primary);
  }

  // ── The tamer + the spirit-chain throw → spin → spawn (the headline beat) ────
  // Arm: rest → wind back (during the wipe) → swing forward at THROW_START.
  let armT;
  if (e < WIPE_END) armT = lerp(0.35, 0.0, easeOut(wipeP)); // ease into the wind-up
  else if (e < THROW_START) armT = lerp(0.0, 1.0, easeIn(seg(e, WIPE_END, THROW_START))); // pull through to release
  else armT = lerp(1.0, 0.45, easeInOut(seg(e, THROW_START, THROW_START + 0.5))); // follow-through, relax
  const tx = sx + sw * 0.2, ty = stageBottom - sh * 0.015, tsz = sw * 0.1;
  const hand = drawTamer(k, tx, ty, tsz, armT, mix(THEME.primary, chainCol, 0.4));

  // Chain in flight: arc from the hand to the enemy spot.
  if (e >= THROW_START && spinP < 1 && throwP < 1) {
    const p = easeIn(throwP);
    const cxp = lerp(hand.x, ex, p);
    const cyp = lerp(hand.y, ey, p) - Math.sin(throwP * Math.PI) * sh * 0.34; // arc lift
    // comet trail along the reverse of travel
    for (let i = 1; i <= 6; i++) {
      const tp = clamp01(p - i * 0.05), txp = lerp(hand.x, ex, tp), typ = lerp(hand.y, ey, tp) - Math.sin((tp / (p || 1) * throwP) * Math.PI) * sh * 0.34;
      k.drawCircle({ pos: k.vec2(txp, typ), radius: 5 - i * 0.6, color: k.rgb(chainCol[0], chainCol[1], chainCol[2]), opacity: 0.3 - i * 0.04, fixed: true });
    }
    drawChainRing(k, cxp, cyp, chainCol, time * 8 + throwP * 12, 9, 1, 1);
  }

  // At the enemy spot the chain OPENS: grows bigger while the spin accelerates to a
  // blur (angle ∝ spinP² → angular velocity ramps up), then on SPAWN it bursts.
  if (spinP > 0 && spawnP < 1) {
    const grow = lerp(9, sw * 0.13, easeIn(spinP));
    const spinAng = spinP * spinP * TWO_PI * 7 + time * 4; // accelerating
    const ringFade = 1 - spawnP; // links blow apart as the monster emerges
    const radius = grow * (1 + 1.4 * spawnP); // and fly outward on spawn
    drawChainRing(k, ex, ey, chainCol, spinAng + spawnP * 6, radius, ringFade, 1 + spinP * 1.4);
    // Spawn flash + outward link shards.
    if (spawnP > 0) {
      const fl = 1 - easeOut(seg(spawnP, 0, 0.45));
      k.drawCircle({ pos: k.vec2(ex, ey), radius: grow * (0.6 + spawnP * 1.5), color: k.rgb(255, 255, 255), opacity: 0.8 * fl, fixed: true });
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TWO_PI + spawnP * 2, r0 = grow + spawnP * sw * 0.16;
        k.drawLine({ p1: k.vec2(ex + Math.cos(a) * grow, ey + Math.sin(a) * grow), p2: k.vec2(ex + Math.cos(a) * r0, ey + Math.sin(a) * r0), width: 2.2 * ringFade + 0.3, color: k.rgb(chainCol[0], chainCol[1], chainCol[2]), opacity: 0.7 * ringFade, fixed: true });
      }
    }
  }

  // ── The enemy monster bursts out of the chain and lands with a squash ───────
  if (enemy && (spawnP > 0 || e >= SPAWN_END)) {
    const eSlug = String(enemy.typeName || "").toLowerCase().replace(/\s+/g, "_");
    const base = e >= SPAWN_END ? 1 : easeOutBack(spawnP);
    const ew = sw * 0.26, eh = ew;
    // squash/stretch: stretched tall as it pops, settling square (skip under reduced motion).
    const sq = reducedMotion ? 0 : Math.sin(clamp01(spawnP) * Math.PI) * 0.18;
    const w = ew * base * (1 - sq), h = eh * base * (1 + sq);
    const ecy = ey - h * 0.36 + (e >= SPAWN_END ? idle * 2 : 0);
    drawCreature(k, eSlug, ex, ecy, w, h, clamp01(base), ec);
  }

  // ── Transition: a flash + venetian-blind wipe that retracts to reveal the stage.
  if (wipeP < 1) {
    const NB = 7, bandH = sh / NB;
    for (let i = 0; i < NB; i++) {
      const local = clamp01((wipeP - (i / NB) * 0.5) / 0.5); // staggered sweep top→bottom
      const cover = (1 - easeInOut(local)) * bandH;
      if (cover <= 0) continue;
      const by = sy + i * bandH;
      k.drawRect({ pos: k.vec2(sx, by), width: sw, height: cover, color: k.rgb(...THEME.bgAlt), fixed: true });
      k.drawRect({ pos: k.vec2(sx, by + cover - 1.5), width: sw, height: 1.5, color: k.rgb(ec[0], ec[1], ec[2]), opacity: 0.6, fixed: true }); // bright retracting edge
    }
    // opening flash
    const flash = clamp01(1 - wipeP / 0.4) * 0.55;
    if (flash > 0) k.drawRect({ pos: k.vec2(sx, sy), width: sw, height: sh, color: k.rgb(255, 255, 255), opacity: flash, fixed: true });
  }
}
