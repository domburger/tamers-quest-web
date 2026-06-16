// Pokémon-style battle stage + entry cinematic (user request 2026-06-10:
// "a battle screen like in pokemon games … a nice transition … the player throws
// the spirit chain, it opens up getting bigger + spinning faster, the monster
// spawns out of it").
//
// Like Pokémon: the ENEMY (the wild monster you encountered) is already on the field;
// the tamer throws the chain to summon THEIR OWN active monster onto the player platform
// — the chain arcs to the player's spot and the active monster bursts out of it. The
// tamer is drawn in the player's EQUIPPED character colours (accent + cloak).
//
// Pure kaboom-primitive draws (mirrors render/spiritchain.js / render/character.js):
// no new sprites, no tween engine — the whole cinematic is parametrized by a single
// `introElapsed` clock so it's deterministic and immediate-mode faithful. Everything
// is drawn `fixed:true` (screen space) inside the square play window, above the
// combat panel, so it sits over the (frozen) world the same way the panel does.
//
// Called from onlineGame's combat onDraw. Coordinates are design units.

import { THEME, accentColor } from "../ui/theme.js";
import { monsterAnimTransform } from "../systems/monsterAnim.js"; // standard ATTACK clip (idle/walk/attack), so a combat blow uses the same animation system as the overworld
import { slugOf } from "./monster.js"; // canonical (memoized) sprite-key derivation — shared so the slug isn't re-derived per frame
import { drawCharacter } from "./character.js"; // the EXACT player figure (same vector used in lobby/overworld), rendered screen-space via its fixed-mode
import { getMonsterType } from "../engine/gamedata.js"; // TQ-262: resolve a combatant's TYPE to check for an html visual model
import { hasHtmlModel } from "../systems/htmlModel.js"; // TQ-262: combatants with an html model render via the live-DOM overlay instead of the sprite

// ── Cinematic timeline (seconds, cumulative) ──────────────────────────────────
const WIPE_END    = 0.42; // transition blinds retract → stage revealed
const THROW_START = 0.52; // a beat after the wipe, the tamer releases the chain
const THROW_END   = 0.96; // chain finishes its arc to the enemy spot
const SPIN_END    = 1.78; // chain has grown + spun up to a blur
const SPAWN_END   = 2.34; // monster has fully burst out and settled
export const BATTLE_INTRO_DURATION = SPAWN_END;

// ── Catch cinematic (the tamer throws a chain AT the enemy to capture it) ─────
// Driven by a SEPARATE `catchElapsed` clock (set when the player presses Catch). The chain arcs to the
// enemy, the wild monster is sucked into the wobbling chain, then the server verdict resolves: caught
// (ring snaps shut + capture flash + sparkle) or broke free (ring blows outward + the monster bursts back).
const CATCH_THROW_END   = 0.42; // chain finishes its arc hand → enemy spot (then it "holds" the monster)
const CATCH_SUCCESS_DUR = 0.70; // caught: ring contracts to nothing + capture flash + sparkle
const CATCH_BREAK_DUR   = 0.50; // broke free: ring blows outward + the monster pops back out

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

// The backdrop sky (48 bands) + ground (24 bands) gradients are pure functions of their two endpoint
// colours + the band count — they don't change frame-to-frame within a combat (accentColor() is a frozen
// constant; the THEME palette only shifts on a global flip). Caching the per-band mix() colours drops 72
// array allocations + colour derivations PER COMBAT FRAME. Self-invalidating: rebuilt only when an
// endpoint colour actually changes (a palette flip is then picked up on the next frame — no staleness).
const _sameRgb = (p, q) => p[0] === q[0] && p[1] === q[1] && p[2] === q[2];
const _gradCache = new Map(); // key -> { a:[r,g,b], b:[r,g,b], cols:[[r,g,b], …] }
function bandColors(key, a, b, n) {
  const c = _gradCache.get(key);
  if (c && c.cols.length === n && _sameRgb(c.a, a) && _sameRgb(c.b, b)) return c.cols;
  const cols = new Array(n);
  for (let i = 0; i < n; i++) cols[i] = mix(a, b, i / (n - 1));
  _gradCache.set(key, { a: [a[0], a[1], a[2]], b: [b[0], b[1], b[2]], cols });
  return cols;
}

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

// The CATCH throw: a spirit chain arcs from the tamer's hand to the enemy, wobbles while it holds the
// monster (suspense), then either snaps shut (caught) or blows outward (broke free). Mirrors the summon
// throw arc but TARGETS the enemy. All fixed:true screen-space (drawn over the stage). `throwP` 0→1 is
// the arc; `landed` switches to the hold/resolve; `caughtP`/`brokeP` 0→1 drive the verdict.
function drawCatchThrow(k, { hand, capX, capY, chainCol, time, sw, sh, throwP, landed, caughtP, brokeP }) {
  const col = k.rgb(chainCol[0], chainCol[1], chainCol[2]);
  // In flight: arc from the hand to the enemy, with a comet trail (mirrors the summon throw).
  if (!landed && throwP < 1) {
    const p = easeIn(throwP);
    const cxp = lerp(hand.x, capX, p);
    const cyp = lerp(hand.y, capY, p) - Math.sin(throwP * Math.PI) * sh * 0.30; // arc lift
    for (let i = 1; i <= 6; i++) {
      const tp = clamp01(p - i * 0.05), txp = lerp(hand.x, capX, tp);
      const typ = lerp(hand.y, capY, tp) - Math.sin((tp / (p || 1) * throwP) * Math.PI) * sh * 0.30;
      k.drawCircle({ pos: k.vec2(txp, typ), radius: 5 - i * 0.6, color: col, opacity: 0.3 - i * 0.04, fixed: true });
    }
    drawChainRing(k, cxp, cyp, chainCol, time * 8 + throwP * 12, 9, 1, 1);
    return;
  }
  if (!landed) return;
  if (caughtP > 0) {
    // CAUGHT: the chain contracts to a point around the monster + a bright capture flash, then a sparkle.
    const fade = 1 - caughtP;
    const r = lerp(sw * 0.12, 2, easeIn(caughtP));
    drawChainRing(k, capX, capY, chainCol, time * 18 + caughtP * 10, r, fade, 1 + caughtP * 1.3);
    const fl = Math.sin(clamp01(caughtP / 0.5) * Math.PI);
    if (fl > 0) k.drawCircle({ pos: k.vec2(capX, capY), radius: sw * 0.05 * fl + 2, color: k.rgb(255, 255, 255), opacity: 0.9 * fl, fixed: true });
    if (caughtP > 0.5) { // celebratory spark ring on the snap-shut
      const q = (caughtP - 0.5) / 0.5, n = 8;
      for (let i = 0; i < n; i++) { const a = (i / n) * TWO_PI + caughtP * 3, rr = sw * 0.04 + q * sw * 0.13;
        k.drawCircle({ pos: k.vec2(capX + Math.cos(a) * rr, capY + Math.sin(a) * rr), radius: 2.4 * (1 - q) + 0.5, color: col, opacity: 0.85 * (1 - q), fixed: true }); }
    }
  } else if (brokeP > 0) {
    // BROKE FREE: the chain blows OUTWARD + snapped-link shards fling out, desaturated (no white core) so a
    // failed catch reads distinctly from a success. The monster pops back via captureScale (enemy draw).
    const fade = 1 - brokeP;
    const r = lerp(sw * 0.10, sw * 0.26, brokeP);
    const dim = [Math.round(chainCol[0] * 0.5 + 40), Math.round(chainCol[1] * 0.5 + 40), Math.round(chainCol[2] * 0.5 + 40)];
    drawChainRing(k, capX, capY, dim, time * 6 + brokeP * 8, r, fade, 1);
    const dcol = k.rgb(dim[0], dim[1], dim[2]), n = 7;
    for (let i = 0; i < n; i++) { const a = (i / n) * TWO_PI + brokeP, r0 = sw * 0.08 + brokeP * sw * 0.18, r1 = r0 + sw * 0.03;
      k.drawLine({ p1: k.vec2(capX + Math.cos(a) * r0, capY + Math.sin(a) * r0), p2: k.vec2(capX + Math.cos(a) * r1, capY + Math.sin(a) * r1), width: 2.2 * fade + 0.3, color: dcol, opacity: 0.7 * fade, fixed: true }); }
  } else {
    // HOLDING: the chain wobbles around the shrunken monster — suspense pulse while awaiting the verdict.
    const wob = Math.sin(time * 16) * 0.06, r = sw * 0.10 * (1 + wob);
    drawChainRing(k, capX, capY, chainCol, time * 10, r, 1, 1.1 + 0.2 * Math.sin(time * 8));
  }
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
 * @param {?number} [o.chainTier]  active slot's tier (1-6) → tier-coloured core on the held chain (null = neutral)
 * @param {{accent:number[],cloak:number[]}} [o.charSkin]  player's equipped character skin (tamer colours)
 * @param {number} o.time   k.time() — idle/spin clock
 * @param {number} o.introElapsed  seconds since this combat started
 * @param {boolean} o.reducedMotion  a11y: skip the cinematic, show the settled stage
 * @param {number} [o.enemyAttack]  0..1 phase of the enemy's one-shot ATTACK lunge (0 = not attacking)
 * @param {number} [o.activeAttack] 0..1 phase of the player monster's ATTACK lunge (0 = not attacking)
 * @param {number} [o.catchElapsed]  seconds since the player pressed Catch (the chain-throw clock); <0 = no catch
 * @param {?string} [o.catchResolve]  "caught" | "broke" once the server verdict arrives (null = still awaiting)
 * @param {number} [o.catchResolveElapsed]  seconds since the verdict (drives the snap-shut / break-free); <0 = none
 */
export function drawBattleStage(k, { rect, stageBottom, enemy, active, chainCol, chainTier = null, charSkin, time, introElapsed, reducedMotion, enemyAttack = 0, activeAttack = 0, htmlSink = null, catchElapsed = -1, catchResolve = null, catchResolveElapsed = -1 }) {
  const sx = rect.x, sy = rect.y, sw = rect.size, sh = stageBottom - rect.y;
  if (sh <= 20) return; // no room (degenerate viewport) — let the panel stand alone
  // a11y: collapse the cinematic to its end state (no flashes / spin / fling).
  const e = reducedMotion ? BATTLE_INTRO_DURATION : Math.max(0, introElapsed);

  const ec = enemy ? accentColor() : THEME.primary;
  // The tamer wears the player's EQUIPPED character colours (accent + cloak), so the
  // battle figure is recognisably them. Cloak is lifted toward the accent so the (often
  // very dark) cloak tint stays legible against the dark stage backdrop.
  const charAccent = (charSkin && charSkin.accent) || THEME.primary;
  const charCloak = (charSkin && charSkin.cloak) ? mix(charSkin.cloak, charAccent, 0.35) : mix(THEME.bgAlt, charAccent, 0.55);
  const hy = sy + sh * 0.54; // horizon

  // ── Backdrop ────────────────────────────────────────────────────────────────
  k.drawRect({ pos: k.vec2(sx, sy), width: sw, height: sh, color: k.rgb(...THEME.bg), fixed: true }); // opaque — hides the frozen world
  // Sky: vertical gradient bands, dark crown → element-tinted horizon glow.
  const skyTop = mix(THEME.bgAlt, ec, 0.05), skyHorizon = mix(THEME.bg, ec, 0.22);
  // Many thin bands → a smooth gradient. 10 left visible horizontal steps (banding) in
  // the backdrop; 48 makes each step ~a few px, still trivially cheap (flat fills).
  const BANDS = 48;
  const skyCols = bandColors("sky", skyTop, skyHorizon, BANDS); // cached per-band colours (rebuilt only on a palette change)
  for (let i = 0; i < BANDS; i++) {
    const y0 = lerp(sy, hy, i / BANDS), bh = (hy - sy) / BANDS + 1;
    k.drawRect({ pos: k.vec2(sx, y0), width: sw, height: bh, color: k.rgb(...skyCols[i]), fixed: true });
  }
  // Focus glow behind the enemy spot.
  const ex = sx + sw * 0.72, ey = hy - sh * 0.05;
  k.drawCircle({ pos: k.vec2(ex, ey - sh * 0.04), radius: sw * 0.26, color: k.rgb(ec[0], ec[1], ec[2]), opacity: 0.12, fixed: true });
  // Ground.
  const groundFar = mix(THEME.surface, ec, 0.1), groundNear = mix(THEME.bgAlt, ec, 0.04);
  const GROUND_BANDS = 24; // was 6 — match the smoother sky so the ground doesn't step
  const groundCols = bandColors("ground", groundFar, groundNear, GROUND_BANDS);
  for (let i = 0; i < GROUND_BANDS; i++) {
    const y0 = lerp(hy, stageBottom, i / GROUND_BANDS), bh = (stageBottom - hy) / GROUND_BANDS + 1;
    k.drawRect({ pos: k.vec2(sx, y0), width: sw, height: bh, color: k.rgb(...groundCols[i]), fixed: true });
  }
  k.drawLine({ p1: k.vec2(sx, hy), p2: k.vec2(sx + sw, hy), width: 1.5, color: k.rgb(...mix(skyHorizon, ec, 0.4)), opacity: 0.5, fixed: true });

  // ── Platforms ─────────────────────────────────────────────────────────────
  const px = sx + sw * 0.34, py = stageBottom - sh * 0.13; // player monster spot
  drawPlatform(k, ex, ey, sw * 0.2, sw * 0.052, ec);
  drawPlatform(k, px, py, sw * 0.24, sw * 0.066, active ? accentColor() : THEME.primary);

  // Phase clocks.
  const wipeP = seg(e, 0, WIPE_END);
  const throwP = seg(e, THROW_START, THROW_END);
  const spinP = seg(e, THROW_END, SPIN_END);
  const spawnP = seg(e, SPIN_END, SPAWN_END);
  const idle = reducedMotion ? 0 : Math.sin(time * 2);

  // ── Catch cinematic phases (the player threw a chain AT the enemy). Inert when catchElapsed < 0. ──
  const catchOn = catchElapsed >= 0;
  const caughtP = (catchResolve === "caught" && catchResolveElapsed >= 0) ? clamp01(catchResolveElapsed / CATCH_SUCCESS_DUR) : 0;
  const brokeP  = (catchResolve === "broke"  && catchResolveElapsed >= 0) ? clamp01(catchResolveElapsed / CATCH_BREAK_DUR)   : 0;
  const catchThrowP = catchOn && !reducedMotion ? seg(catchElapsed, 0, CATCH_THROW_END) : 1;
  const catchLanded = catchOn && (catchElapsed >= CATCH_THROW_END || !!catchResolve || reducedMotion); // chain reached the enemy → now holding/resolving
  // Enemy "sucked into the chain": once the chain lands, shrink (+ fade for a catch). Held at ~half size,
  // wobbling, while awaiting the verdict; → 0 if caught, back to full (overshoot) if it broke free.
  let captureScale = 1, captureOpacity = 1;
  if (catchOn && catchLanded) {
    const HOLD = 0.46; // held size while the chain wobbles around the captured monster
    if (caughtP > 0)     { captureScale = lerp(HOLD, 0, easeIn(caughtP)); captureOpacity = 1 - caughtP; }
    else if (brokeP > 0) { captureScale = lerp(HOLD, 1, easeOutBack(brokeP)); }
    else                 { captureScale = HOLD + (reducedMotion ? 0 : Math.sin(time * 16) * 0.04); } // wobble while awaiting
  }
  if (reducedMotion && catchResolve === "caught") { captureScale = 0; captureOpacity = 0; } // a11y: just show the result

  // ── Enemy monster: ALREADY on the field (the wild monster you ran into). It fades
  // + settles in as the stage is revealed — the tamer does NOT summon it. ─────────
  if (enemy) {
    const inP = easeOut(seg(e, 0.1, 0.6));
    const ew = sw * 0.26, eh = ew;
    const baseCx = ex, baseCy = ey - eh * 0.36 + (1 - inP) * 22 + idle * 2;
    // CAPTURE: while a chain holds the enemy, it shrinks toward the chain (+ fades on a successful catch).
    const eInP = inP * captureOpacity, eScale = captureScale;
    // TQ-262: a combatant whose TYPE has an html model renders as a live-DOM node (faces LEFT, toward
    // the player's monster); its CSS attack state drives the lunge, so it uses the BASE position (no
    // canvas attack offset). Otherwise the baked sprite, with the standard ATTACK clip displacement.
    const eType = htmlSink && getMonsterType(enemy.typeName);
    if (eType && hasHtmlModel(eType)) {
      if (eInP > 0.01 && eScale > 0.01) htmlSink.push({ id: "combat-enemy", typeName: enemy.typeName, type: eType, x: baseCx, y: baseCy, designSize: ew * eScale, facing: -1, attacking: enemyAttack > 0, opacity: eInP });
    } else {
      let ecx = baseCx, ecy = baseCy, ewd = ew * eScale, ehd = eh * eScale;
      if (enemyAttack > 0) {
        const tr = monsterAnimTransform("attack", 0, { phase: enemyAttack, facing: -1 });
        ecx += tr.dx * ew; ecy += tr.dy * eh; ewd *= tr.sx; ehd *= tr.sy;
      }
      drawCreature(k, slugOf(enemy.typeName), ecx, ecy, ewd, ehd, eInP, ec);
    }
  }

  // ── The tamer + the spirit-chain throw → spin → spawn (the headline beat) ────
  // Arm: rest → wind back (during the wipe) → swing forward at THROW_START.
  let armT;
  if (e < WIPE_END) armT = lerp(0.35, 0.0, easeOut(wipeP)); // ease into the wind-up
  else if (e < THROW_START) armT = lerp(0.0, 1.0, easeIn(seg(e, WIPE_END, THROW_START))); // pull through to release
  else armT = lerp(1.0, 0.45, easeInOut(seg(e, THROW_START, THROW_START + 0.5))); // follow-through, relax
  // The player's EXACT character (same vector model as the lobby/overworld), drawn in
  // screen space via drawCharacter's fixed-mode and posed from behind (facing the field).
  // armT is folded into the upper-body lean so the throw still reads as a wind-up→swing.
  const tx = sx + sw * 0.13, ty = stageBottom - sh * 0.02; // lower-LEFT foreground (Pokémon framing) — clear of the player monster's platform so the big creature doesn't occlude the hero
  const cs = sw * 0.006; // scale tuned in-fight so the tamer reads as a clear foreground hero (not a corner speck)
  const charModel = (charSkin && charSkin.model) || "cloak";
  const lunge = (armT - 0.4) * 0.9; // <0 wind-up (lean back), >0 swing-through (lean toward field)
  const cy0 = ty - 15 * cs; // lift so the figure's ground-shadow lands at ty (feet on the platform line)
  drawCharacter(k, {
    x: tx, y: cy0, t: time, moving: false,
    color: charAccent, cloak: charCloak, skin: (charSkin && charSkin.chain) || null,
    chainTier, // SC-tier: held core shows the active slot's tier (the chain available in combat)
    dir: { x: lunge, y: -1 }, // back view (faces the field); x leans the torso with the throw
    scale: cs, model: charModel, fixed: true,
  });
  // Chain launches from the figure's held-ring side (matches drawCharacter's arm/ring offset).
  const hand = k.vec2(tx + 16 * cs, cy0 + 2 * cs);

  // The tamer throws the chain to summon HIS OWN monster onto the player platform (px):
  // the chain arcs there, opens + spins up, then the active monster bursts out of it.
  const aw = sw * 0.3, ah = aw;
  const spawnY = py - ah * 0.34; // the active monster's settled centre

  // Chain in flight: arc from the hand to the player's monster spot.
  if (e >= THROW_START && spinP < 1 && throwP < 1) {
    const p = easeIn(throwP);
    const cxp = lerp(hand.x, px, p);
    const cyp = lerp(hand.y, spawnY, p) - Math.sin(throwP * Math.PI) * sh * 0.34; // arc lift
    // comet trail along the reverse of travel
    for (let i = 1; i <= 6; i++) {
      const tp = clamp01(p - i * 0.05), txp = lerp(hand.x, px, tp), typ = lerp(hand.y, spawnY, tp) - Math.sin((tp / (p || 1) * throwP) * Math.PI) * sh * 0.34;
      k.drawCircle({ pos: k.vec2(txp, typ), radius: 5 - i * 0.6, color: k.rgb(chainCol[0], chainCol[1], chainCol[2]), opacity: 0.3 - i * 0.04, fixed: true });
    }
    drawChainRing(k, cxp, cyp, chainCol, time * 8 + throwP * 12, 9, 1, 1);
  }

  // At the player's spot the chain OPENS: grows bigger while the spin accelerates to a
  // blur (angle ∝ spinP² → angular velocity ramps up), then on SPAWN it bursts.
  if (spinP > 0 && spawnP < 1) {
    const grow = lerp(9, sw * 0.14, easeIn(spinP));
    const spinAng = spinP * spinP * TWO_PI * 7 + time * 4; // accelerating
    const ringFade = 1 - spawnP; // links blow apart as the monster emerges
    const radius = grow * (1 + 1.4 * spawnP); // and fly outward on spawn
    drawChainRing(k, px, spawnY, chainCol, spinAng + spawnP * 6, radius, ringFade, 1 + spinP * 1.4);
    // Spawn flash + outward link shards.
    if (spawnP > 0) {
      const fl = 1 - easeOut(seg(spawnP, 0, 0.45));
      k.drawCircle({ pos: k.vec2(px, spawnY), radius: grow * (0.6 + spawnP * 1.5), color: k.rgb(255, 255, 255), opacity: 0.8 * fl, fixed: true });
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TWO_PI + spawnP * 2, r0 = grow + spawnP * sw * 0.16;
        k.drawLine({ p1: k.vec2(px + Math.cos(a) * grow, spawnY + Math.sin(a) * grow), p2: k.vec2(px + Math.cos(a) * r0, spawnY + Math.sin(a) * r0), width: 2.2 * ringFade + 0.3, color: k.rgb(chainCol[0], chainCol[1], chainCol[2]), opacity: 0.7 * ringFade, fixed: true });
      }
    }
  }

  // ── The player's active monster bursts out of the chain and lands with a squash ─
  if (active && (spawnP > 0 || e >= SPAWN_END)) {
    const base = e >= SPAWN_END ? 1 : easeOutBack(spawnP);
    // squash/stretch: stretched tall as it pops, settling square (skip under reduced motion).
    const sq = reducedMotion ? 0 : Math.sin(clamp01(spawnP) * Math.PI) * 0.18;
    let w = aw * base * (1 - sq), h = ah * base * (1 + sq);
    let acx = px, acy = spawnY + (e >= SPAWN_END ? idle * 2 : 0);
    // TQ-262: html-model active monster → live-DOM node (faces RIGHT, toward the enemy); its CSS attack
    // state drives the lunge, so use the settled BASE position/size (canvas squash + attack offset are
    // sprite-only). Only emit it once the entry cinematic has settled (e >= SPAWN_END) so the chain
    // spawn-burst still plays; before that it stays absent (the DOM node pops in on settle).
    const aType = htmlSink && getMonsterType(active.typeName);
    if (aType && hasHtmlModel(aType)) {
      if (e >= SPAWN_END) htmlSink.push({ id: "combat-active", typeName: active.typeName, type: aType, x: px, y: spawnY + idle * 2, designSize: aw, facing: 1, attacking: activeAttack > 0, opacity: 1 });
    } else {
      // Standard ATTACK clip: once the entry cinematic has settled, the player's monster lunges RIGHT
      // (toward the enemy spot at the higher-x position). Layered on top of the settled idle bob.
      if (activeAttack > 0 && e >= SPAWN_END) {
        const tr = monsterAnimTransform("attack", 0, { phase: activeAttack, facing: 1 });
        acx += tr.dx * aw; acy += tr.dy * ah; w *= tr.sx; h *= tr.sy;
      }
      drawCreature(k, slugOf(active.typeName), acx, acy, w, h, clamp01(base), active ? accentColor() : THEME.primary);
    }
  }

  // ── Catch: the tamer throws a chain AT the enemy, then it captures / breaks free ──────────────
  if (catchOn && !reducedMotion) {
    const capX = ex, capY = ey - (sw * 0.26) * 0.36; // the enemy creature's centre (matches the enemy draw)
    drawCatchThrow(k, { hand, capX, capY, chainCol, time, sw, sh, throwP: catchThrowP, landed: catchLanded, caughtP, brokeP });
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
