import { THEME, accentColor } from "../ui/theme.js";
import { monsterAnimTransform } from "../systems/monsterAnim.js";
import { slugOf } from "./monster.js";
import { drawCharacter } from "./character.js";
import { getMonsterType } from "../engine/gamedata.js";
import { hasHtmlModel } from "../systems/htmlModel.js";
import { fightBackground } from "./fightBackgrounds.js";

const WIPE_END    = 0.42;
const THROW_START = 0.52;
const THROW_END   = 0.96;
const SPIN_END    = 1.78;
const SPAWN_END   = 2.34;
export const BATTLE_INTRO_DURATION = SPAWN_END;

const CATCH_THROW_END   = 0.42;
const CATCH_SUCCESS_DUR = 0.70;
const CATCH_BREAK_DUR   = 0.50;

const TWO_PI = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const seg = (e, a, b) => clamp01((e - a) / (b - a));
const easeOut = (p) => 1 - (1 - p) * (1 - p);
const easeIn = (p) => p * p;
const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const easeOutBack = (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];

const _sameRgb = (p, q) => p[0] === q[0] && p[1] === q[1] && p[2] === q[2];
const _gradCache = new Map();
function bandColors(key, a, b, n) {
  const c = _gradCache.get(key);
  if (c && c.cols.length === n && _sameRgb(c.a, a) && _sameRgb(c.b, b)) return c.cols;
  const cols = new Array(n);
  for (let i = 0; i < n; i++) cols[i] = mix(a, b, i / (n - 1));
  _gradCache.set(key, { a: [a[0], a[1], a[2]], b: [b[0], b[1], b[2]], cols });
  return cols;
}

function drawCreature(k, slug, cx, cy, w, h, opacity, tint) {
  if (opacity <= 0 || w <= 0 || h <= 0) return;
  try {
    k.drawSprite({ sprite: slug, pos: k.vec2(cx, cy), anchor: "center", width: w, height: h, opacity, fixed: true });
  } catch {
    k.drawCircle({ pos: k.vec2(cx, cy), radius: w * 0.42, color: k.rgb(tint[0], tint[1], tint[2]), opacity: 0.9 * opacity, fixed: true });
    k.drawCircle({ pos: k.vec2(cx - w * 0.13, cy - h * 0.08), radius: w * 0.07, color: k.rgb(255, 255, 255), opacity: 0.9 * opacity, fixed: true });
    k.drawCircle({ pos: k.vec2(cx + w * 0.13, cy - h * 0.08), radius: w * 0.07, color: k.rgb(255, 255, 255), opacity: 0.9 * opacity, fixed: true });
  }
}

function drawPlatform(k, cx, cy, rx, ry, tint) {
  k.drawEllipse({ pos: k.vec2(cx, cy + ry * 0.5), radiusX: rx * 1.04, radiusY: ry * 1.05, color: k.rgb(0, 0, 0), opacity: 0.30, fixed: true });
  k.drawEllipse({ pos: k.vec2(cx, cy), radiusX: rx, radiusY: ry, color: k.rgb(...mix(THEME.bg, tint, 0.16)), opacity: 0.92, fixed: true });
  k.drawEllipse({ pos: k.vec2(cx, cy - ry * 0.12), radiusX: rx * 0.9, radiusY: ry * 0.8, color: k.rgb(...mix(THEME.surface, tint, 0.22)), opacity: 0.85, fixed: true });
  const dashes = 22;
  for (let i = 0; i < dashes; i++) {
    const a0 = (i / dashes) * Math.PI * 2, a1 = a0 + Math.PI * 2 / dashes * 0.55;
    const r0 = 0.97;
    k.drawLine({ p1: k.vec2(cx + Math.cos(a0) * rx * r0, cy + Math.sin(a0) * ry * r0), p2: k.vec2(cx + Math.cos(a1) * rx * r0, cy + Math.sin(a1) * ry * r0), width: 1.6, color: k.rgb(tint[0], tint[1], tint[2]), opacity: 0.55 + 0.3 * Math.max(0, -Math.sin(a0)), fixed: true });
  }
  k.drawEllipse({ pos: k.vec2(cx, cy - ry * 0.3), radiusX: rx * 0.56, radiusY: ry * 0.34, color: k.rgb(...mix([255, 255, 255], tint, 0.5)), opacity: 0.16, fixed: true });
  k.drawEllipse({ pos: k.vec2(cx, cy), radiusX: rx * 0.5, radiusY: ry * 0.45, color: k.rgb(tint[0], tint[1], tint[2]), opacity: 0.1, fixed: true });
}

function drawSoftGlow(k, cx, cy, r, tint, peak) {
  const t = [tint[0], tint[1], tint[2]];
  k.drawCircle({ pos: k.vec2(cx, cy), radius: r, color: k.rgb(t[0], t[1], t[2]), opacity: 1, fixed: true,
    gradient: { stops: [[0, t, peak], [0.35, t, peak * 0.55], [0.7, t, peak * 0.18], [1, t, 0]] } });
}

function drawPadGlow(k, cx, cy, rx, ry, tint, pulse) {
  const a = 0.2 + 0.08 * pulse;
  const t = [tint[0], tint[1], tint[2]];
  k.drawEllipse({ pos: k.vec2(cx, cy), radiusX: rx * 1.6, radiusY: ry * 1.6, color: k.rgb(t[0], t[1], t[2]), opacity: 1, fixed: true,
    gradient: { stops: [[0, t, a], [0.55, t, a * 0.75], [0.75, t, a * 0.3], [1, t, 0]] } });
}

const _MOTES = Array.from({ length: 14 }, (_, i) => ({
  fx: (i * 0.61803398875) % 1,
  fy: (i * 0.75487766625) % 1,
  r: 1 + (i % 3) * 0.8,
  spd: 0.018 + (i % 5) * 0.006,
  sway: 5 + (i % 4) * 4,
  phase: i * 1.37,
}));
function drawMotes(k, sx, sy, sw, sh, time, tint) {
  for (const m of _MOTES) {
    const y = sy + sh * (((m.fy - time * m.spd) % 1 + 1) % 1);
    let x = sx + sw * (0.05 + 0.9 * m.fx) + Math.sin(time * 0.5 + m.phase) * m.sway;
    if (x < sx + 2) x = sx + 2; else if (x > sx + sw - 2) x = sx + sw - 2;
    const tw = 0.5 + 0.5 * Math.sin(time * 1.3 + m.phase);
    k.drawCircle({ pos: k.vec2(x, y), radius: m.r, color: k.rgb(tint[0], tint[1], tint[2]), opacity: 0.08 + 0.14 * tw, fixed: true });
  }
}

const _ringPts = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];

function drawChainRing(k, x, y, color, angle, radius, opacity, glow = 1) {
  if (opacity <= 0) return;
  const col = k.rgb(color[0], color[1], color[2]);
  const LINKS = 6; // Must equal _ringPts.length.
  k.drawCircle({ pos: k.vec2(x, y), radius: radius * 1.7, color: col, opacity: 0.18 * opacity * glow, fixed: true });
  const pts = _ringPts;
  for (let i = 0; i < LINKS; i++) { const a = angle + (i / LINKS) * TWO_PI; const pt = pts[i]; pt.x = x + Math.cos(a) * radius; pt.y = y + Math.sin(a) * radius; }
  for (let i = 0; i < LINKS; i++) k.drawLine({ p1: pts[i], p2: pts[(i + 1) % LINKS], width: 2.4, color: col, opacity: 0.75 * opacity, fixed: true });
  for (const p of pts) k.drawCircle({ pos: p, radius: 4.6, color: col, opacity: 0.2 * opacity, fixed: true });
  for (const p of pts) k.drawCircle({ pos: p, radius: 2.6, color: col, opacity, fixed: true });
  k.drawCircle({ pos: k.vec2(x, y), radius: radius * 0.32 + 2, color: k.rgb(255, 255, 255), opacity: clamp01(0.25 + 0.7 * (glow - 1) * 0.5) * opacity, fixed: true });
}

function drawCatchThrow(k, { hand, capX, capY, chainCol, time, sw, sh, throwP, landed, caughtP, brokeP }) {
  const col = k.rgb(chainCol[0], chainCol[1], chainCol[2]);
  if (!landed && throwP < 1) {
    const p = easeIn(throwP);
    const cxp = lerp(hand.x, capX, p);
    const cyp = lerp(hand.y, capY, p) - Math.sin(throwP * Math.PI) * sh * 0.30;
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
    const fade = 1 - caughtP;
    const r = lerp(sw * 0.12, 2, easeIn(caughtP));
    drawChainRing(k, capX, capY, chainCol, time * 18 + caughtP * 10, r, fade, 1 + caughtP * 1.3);
    const fl = Math.sin(clamp01(caughtP / 0.5) * Math.PI);
    if (fl > 0) k.drawCircle({ pos: k.vec2(capX, capY), radius: sw * 0.05 * fl + 2, color: k.rgb(255, 255, 255), opacity: 0.9 * fl, fixed: true });
    if (caughtP > 0.5) {
      const q = (caughtP - 0.5) / 0.5, n = 8;
      for (let i = 0; i < n; i++) { const a = (i / n) * TWO_PI + caughtP * 3, rr = sw * 0.04 + q * sw * 0.13;
        k.drawCircle({ pos: k.vec2(capX + Math.cos(a) * rr, capY + Math.sin(a) * rr), radius: 2.4 * (1 - q) + 0.5, color: col, opacity: 0.85 * (1 - q), fixed: true }); }
    }
  } else if (brokeP > 0) {
    const fade = 1 - brokeP;
    const r = lerp(sw * 0.10, sw * 0.26, brokeP);
    const dim = [Math.round(chainCol[0] * 0.5 + 40), Math.round(chainCol[1] * 0.5 + 40), Math.round(chainCol[2] * 0.5 + 40)];
    drawChainRing(k, capX, capY, dim, time * 6 + brokeP * 8, r, fade, 1);
    const dcol = k.rgb(dim[0], dim[1], dim[2]), n = 7;
    for (let i = 0; i < n; i++) { const a = (i / n) * TWO_PI + brokeP, r0 = sw * 0.08 + brokeP * sw * 0.18, r1 = r0 + sw * 0.03;
      k.drawLine({ p1: k.vec2(capX + Math.cos(a) * r0, capY + Math.sin(a) * r0), p2: k.vec2(capX + Math.cos(a) * r1, capY + Math.sin(a) * r1), width: 2.2 * fade + 0.3, color: dcol, opacity: 0.7 * fade, fixed: true }); }
  } else {
    const wob = Math.sin(time * 16) * 0.06, r = sw * 0.10 * (1 + wob);
    drawChainRing(k, capX, capY, chainCol, time * 10, r, 1, 1.1 + 0.2 * Math.sin(time * 8));
  }
}

export function drawBattleStage(k, { rect, stageBottom, enemy, active, chainCol, chainTier = null, charSkin, time, introElapsed, reducedMotion, enemyAttack = 0, activeAttack = 0, htmlSink = null, catchElapsed = -1, catchResolve = null, catchResolveElapsed = -1, biomeName = null, biomeAccent = null }) {
  const sx = rect.x, sy = rect.y, sw = rect.size, sh = stageBottom - rect.y;
  if (sh <= 20) return;
  const e = reducedMotion ? BATTLE_INTRO_DURATION : Math.max(0, introElapsed);

  const ec = enemy ? accentColor() : THEME.primary;
  const charAccent = (charSkin && charSkin.accent) || THEME.primary;
  const charCloak = (charSkin && charSkin.cloak) ? mix(charSkin.cloak, charAccent, 0.35) : mix(THEME.bgAlt, charAccent, 0.55);
  const hy = sy + sh * 0.54;

  k.drawRect({ pos: k.vec2(sx, sy), width: sw, height: sh, color: k.rgb(...THEME.bg), fixed: true });
  let usedHtmlBg = false;
  const fbg = fightBackground(biomeName, biomeAccent || ec);
  if (fbg) { try { k.drawSprite({ image: fbg, pos: k.vec2(sx + sw / 2, sy + sh / 2), anchor: "center", width: sw, height: sh, fixed: true }); usedHtmlBg = true; } catch { usedHtmlBg = false; } }
  if (!usedHtmlBg) {
    const skyTop = mix(THEME.bgAlt, ec, 0.05), skyHorizon = mix(THEME.bg, ec, 0.22);
    const BANDS = 48, skyCols = bandColors("sky", skyTop, skyHorizon, BANDS);
    for (let i = 0; i < BANDS; i++) { const y0 = lerp(sy, hy, i / BANDS), bh = (hy - sy) / BANDS + 1; k.drawRect({ pos: k.vec2(sx, y0), width: sw, height: bh, color: k.rgb(...skyCols[i]), fixed: true }); }
    const groundFar = mix(THEME.surface, ec, 0.1), groundNear = mix(THEME.bgAlt, ec, 0.04);
    const GROUND_BANDS = 24, groundCols = bandColors("ground", groundFar, groundNear, GROUND_BANDS);
    for (let i = 0; i < GROUND_BANDS; i++) { const y0 = lerp(hy, stageBottom, i / GROUND_BANDS), bh = (stageBottom - hy) / GROUND_BANDS + 1; k.drawRect({ pos: k.vec2(sx, y0), width: sw, height: bh, color: k.rgb(...groundCols[i]), fixed: true }); }
    k.drawLine({ p1: k.vec2(sx, hy), p2: k.vec2(sx + sw, hy), width: 1.5, color: k.rgb(...mix(skyHorizon, ec, 0.4)), opacity: 0.5, fixed: true });
  }
  const ex = sx + sw * 0.72, ey = hy - sh * 0.05;
  drawSoftGlow(k, ex, ey - sh * 0.04, sw * 0.3, ec, 0.22);

  if (!reducedMotion) drawMotes(k, sx, sy, sw, sh, time, ec);

  const px = sx + sw * 0.34, py = stageBottom - sh * 0.13;
  const pulse = reducedMotion ? 0 : 0.5 + 0.5 * Math.sin(time * 1.6);
  const pAcc = active ? accentColor() : THEME.primary;
  drawPadGlow(k, ex, ey, sw * 0.2, sw * 0.052, ec, pulse);
  drawPadGlow(k, px, py, sw * 0.24, sw * 0.066, pAcc, pulse);
  drawPlatform(k, ex, ey, sw * 0.2, sw * 0.052, ec);
  drawPlatform(k, px, py, sw * 0.24, sw * 0.066, pAcc);

  const wipeP = seg(e, 0, WIPE_END);
  const throwP = seg(e, THROW_START, THROW_END);
  const spinP = seg(e, THROW_END, SPIN_END);
  const spawnP = seg(e, SPIN_END, SPAWN_END);
  const idle = reducedMotion ? 0 : Math.sin(time * 2);

  const catchOn = catchElapsed >= 0;
  const caughtP = (catchResolve === "caught" && catchResolveElapsed >= 0) ? clamp01(catchResolveElapsed / CATCH_SUCCESS_DUR) : 0;
  const brokeP  = (catchResolve === "broke"  && catchResolveElapsed >= 0) ? clamp01(catchResolveElapsed / CATCH_BREAK_DUR)   : 0;
  const catchThrowP = catchOn && !reducedMotion ? seg(catchElapsed, 0, CATCH_THROW_END) : 1;
  const catchLanded = catchOn && (catchElapsed >= CATCH_THROW_END || !!catchResolve || reducedMotion);
  let captureScale = 1, captureOpacity = 1;
  if (catchOn && catchLanded) {
    const HOLD = 0.46;
    if (caughtP > 0)     { captureScale = lerp(HOLD, 0, easeIn(caughtP)); captureOpacity = 1 - caughtP; }
    else if (brokeP > 0) { captureScale = lerp(HOLD, 1, easeOutBack(brokeP)); }
    else                 { captureScale = HOLD + (reducedMotion ? 0 : Math.sin(time * 16) * 0.04); }
  }
  if (reducedMotion && catchResolve === "caught") { captureScale = 0; captureOpacity = 0; }

  if (enemy) {
    const inP = easeOut(seg(e, 0.1, 0.6));
    const ew = sw * 0.26, eh = ew;
    const baseCx = ex, baseCy = ey - eh * 0.36 + (1 - inP) * 22 + idle * 2;
    const eInP = inP * captureOpacity, eScale = captureScale;
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

  let armT;
  if (e < WIPE_END) armT = lerp(0.35, 0.0, easeOut(wipeP));
  else if (e < THROW_START) armT = lerp(0.0, 1.0, easeIn(seg(e, WIPE_END, THROW_START)));
  else armT = lerp(1.0, 0.45, easeInOut(seg(e, THROW_START, THROW_START + 0.5)));
  const tx = sx + sw * 0.13, ty = stageBottom - sh * 0.02;
  const cs = sw * 0.006;
  const charModel = (charSkin && charSkin.model) || "cloak";
  const lunge = (armT - 0.4) * 0.9;
  const cy0 = ty - 15 * cs;
  drawCharacter(k, {
    x: tx, y: cy0, t: time, moving: false,
    color: charAccent, cloak: charCloak, skin: (charSkin && charSkin.chain) || null,
    chainTier,
    dir: { x: lunge, y: -1 },
    scale: cs, model: charModel, fixed: true,
  });
  const hand = k.vec2(tx + 16 * cs, cy0 + 2 * cs);

  const aw = sw * 0.3, ah = aw;
  const spawnY = py - ah * 0.34;

  if (e >= THROW_START && spinP < 1 && throwP < 1) {
    const p = easeIn(throwP);
    const cxp = lerp(hand.x, px, p);
    const cyp = lerp(hand.y, spawnY, p) - Math.sin(throwP * Math.PI) * sh * 0.34;
    for (let i = 1; i <= 6; i++) {
      const tp = clamp01(p - i * 0.05), txp = lerp(hand.x, px, tp), typ = lerp(hand.y, spawnY, tp) - Math.sin((tp / (p || 1) * throwP) * Math.PI) * sh * 0.34;
      k.drawCircle({ pos: k.vec2(txp, typ), radius: 5 - i * 0.6, color: k.rgb(chainCol[0], chainCol[1], chainCol[2]), opacity: 0.3 - i * 0.04, fixed: true });
    }
    drawChainRing(k, cxp, cyp, chainCol, time * 8 + throwP * 12, 9, 1, 1);
  }

  if (spinP > 0 && spawnP < 1) {
    const grow = lerp(9, sw * 0.14, easeIn(spinP));
    const spinAng = spinP * spinP * TWO_PI * 7 + time * 4;
    const ringFade = 1 - spawnP;
    const radius = grow * (1 + 1.4 * spawnP);
    drawChainRing(k, px, spawnY, chainCol, spinAng + spawnP * 6, radius, ringFade, 1 + spinP * 1.4);
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

  if (active && (spawnP > 0 || e >= SPAWN_END)) {
    const base = e >= SPAWN_END ? 1 : easeOutBack(spawnP);
    const sq = reducedMotion ? 0 : Math.sin(clamp01(spawnP) * Math.PI) * 0.18;
    let w = aw * base * (1 - sq), h = ah * base * (1 + sq);
    let acx = px, acy = spawnY + (e >= SPAWN_END ? idle * 2 : 0);
    const aType = htmlSink && getMonsterType(active.typeName);
    if (aType && hasHtmlModel(aType)) {
      if (e >= SPAWN_END) htmlSink.push({ id: "combat-active", typeName: active.typeName, type: aType, x: px, y: spawnY + idle * 2, designSize: aw, facing: 1, attacking: activeAttack > 0, opacity: 1 });
    } else {
      if (activeAttack > 0 && e >= SPAWN_END) {
        const tr = monsterAnimTransform("attack", 0, { phase: activeAttack, facing: 1 });
        acx += tr.dx * aw; acy += tr.dy * ah; w *= tr.sx; h *= tr.sy;
      }
      drawCreature(k, slugOf(active.typeName), acx, acy, w, h, clamp01(base), active ? accentColor() : THEME.primary);
    }
  }

  if (catchOn && !reducedMotion) {
    const capX = ex, capY = ey - (sw * 0.26) * 0.36;
    drawCatchThrow(k, { hand, capX, capY, chainCol, time, sw, sh, throwP: catchThrowP, landed: catchLanded, caughtP, brokeP });
  }

  if (wipeP < 1) {
    const NB = 7, bandH = sh / NB;
    for (let i = 0; i < NB; i++) {
      const local = clamp01((wipeP - (i / NB) * 0.5) / 0.5);
      const cover = (1 - easeInOut(local)) * bandH;
      if (cover <= 0) continue;
      const by = sy + i * bandH;
      k.drawRect({ pos: k.vec2(sx, by), width: sw, height: cover, color: k.rgb(...THEME.bgAlt), fixed: true });
      k.drawRect({ pos: k.vec2(sx, by + cover - 1.5), width: sw, height: 1.5, color: k.rgb(ec[0], ec[1], ec[2]), opacity: 0.6, fixed: true });
    }
    const flash = clamp01(1 - wipeP / 0.4) * 0.55;
    if (flash > 0) k.drawRect({ pos: k.vec2(sx, sy), width: sw, height: sh, color: k.rgb(255, 255, 255), opacity: flash, fixed: true });
  }
}
