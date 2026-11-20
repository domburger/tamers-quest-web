import { drawChainSkin, getEquippedSkin } from "./chainCosmetics.js";
import { prefersReducedMotion } from "../systems/a11y.js";

const lighten = (c, f = 1.6, add = 18) => [
  Math.min(255, Math.round(c[0] * f) + add),
  Math.min(255, Math.round(c[1] * f) + add),
  Math.min(255, Math.round(c[2] * f) + add),
];

const footLift = (step, s, side) => Math.max(0, side * step) * 2 * s;

function cloakModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cx, cy, ucx, ucy, fxu, facingCamera, hemSway } = P;
  k.drawEllipse({ pos: k.vec2(cx, cy + 6 * s), radiusX: 13 * s, radiusY: 16 * s, color: C(...cloak) });
  for (let i = -2; i <= 2; i++) {
    const hh = (5 + (Math.abs(i) % 2) * 4 + (i === 0 ? 3 : 0)) * s;
    k.drawRect({ pos: k.vec2(cx + i * 5 * s + hemSway * 0.4, cy + 18 * s), width: 4.5 * s, height: hh,
      color: C(...cloakDk), anchor: "center", radius: 1 * s });
  }
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 6 * s), radiusX: 10 * s, radiusY: 11 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(fxu(-7), ucy - 4 * s), radiusX: 3 * s, radiusY: 12 * s, color: C(...accent), opacity: 0.28 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 15 * s), radiusX: 9 * s, radiusY: 10 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 20 * s), radiusX: 5.5 * s, radiusY: 6 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(fxu(-4), ucy - 16 * s), radiusX: 2.4 * s, radiusY: 7 * s, color: C(...accent), opacity: 0.24 });
  if (facingCamera) {
    k.drawEllipse({ pos: k.vec2(ucx, ucy - 14 * s), radiusX: 5.5 * s, radiusY: 6.5 * s, color: C(...cloakDk) });
    eyes(P, 2.2, ucy - 14 * s, 1.4);
  }
}

function knightModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cx, cy, ucx, ucy, fxu, flip, facingCamera, t, reduce, step } = P;
  const plate = lighten(cloak, 1.7, 22);
  k.drawRect({ pos: k.vec2(fxu(-4), cy + 13 * s - footLift(step, s, 1)), width: 5 * s, height: 12 * s, color: C(...cloakDk), anchor: "center", radius: 1.5 * s });
  k.drawRect({ pos: k.vec2(fxu(4), cy + 13 * s - footLift(step, s, -1)), width: 5 * s, height: 12 * s, color: C(...cloakDk), anchor: "center", radius: 1.5 * s });
  k.drawEllipse({ pos: k.vec2(cx, cy + 6 * s), radiusX: 11 * s, radiusY: 13 * s, color: C(...cloak) });
  k.drawRect({ pos: k.vec2(ucx, ucy - 4 * s), width: 18 * s, height: 18 * s, color: C(...plate), anchor: "center", radius: 5 * s });
  k.drawRect({ pos: k.vec2(ucx, ucy - 4 * s), width: 2 * s, height: 14 * s, color: C(...cloakDk), anchor: "center", radius: 1 * s });
  k.drawEllipse({ pos: k.vec2(fxu(-8), ucy - 4 * s), radiusX: 2.4 * s, radiusY: 9 * s, color: C(...accent), opacity: 0.3 });
  k.drawEllipse({ pos: k.vec2(fxu(-10), ucy - 7 * s), radiusX: 5 * s, radiusY: 4.5 * s, color: C(...plate) });
  k.drawEllipse({ pos: k.vec2(fxu(10), ucy - 7 * s), radiusX: 5 * s, radiusY: 4.5 * s, color: C(...plate) });
  k.drawEllipse({ pos: k.vec2(fxu(-10), ucy - 8.5 * s), radiusX: 5 * s, radiusY: 1.6 * s, color: C(...accent), opacity: 0.4 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 16 * s), radiusX: 7 * s, radiusY: 8 * s, color: C(...plate) });
  k.drawRect({ pos: k.vec2(ucx, ucy - 13 * s), width: 12 * s, height: 6 * s, color: C(...plate), anchor: "center", radius: 2 * s });
  const crestSway = reduce ? 0 : Math.sin(t * 3) * 0.8;
  for (let i = 0; i < 4; i++) {
    k.drawEllipse({ pos: k.vec2(ucx - flip * (i * 1.4 + crestSway) * s, ucy - 23 * s + i * 1.6 * s),
      radiusX: 2.2 * s, radiusY: (3 - i * 0.3) * s, color: C(...accent), opacity: 0.85 });
  }
  if (facingCamera) {
    k.drawRect({ pos: k.vec2(ucx, ucy - 15 * s), width: 11 * s, height: 3.2 * s, color: C(...cloakDk), anchor: "center", radius: 1.5 * s });
    eyes(P, 2.6, ucy - 15 * s, 1.2);
  }
}

function mageModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cx, cy, ucx, ucy, fxu, flip, facingCamera, hemSway, t, reduce } = P;
  k.drawEllipse({ pos: k.vec2(cx, cy + 7 * s), radiusX: 10 * s, radiusY: 16 * s, color: C(...cloak) });
  for (let i = -2; i <= 2; i++) {
    const hh = (7 + (i === 0 ? 4 : 0)) * s;
    k.drawRect({ pos: k.vec2(cx + i * 4.4 * s + hemSway * 0.4, cy + 19 * s), width: 3.4 * s, height: hh,
      color: C(...cloakDk), anchor: "center", radius: 1 * s });
  }
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 4 * s), radiusX: 7 * s, radiusY: 10 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(fxu(-5), ucy - 3 * s), radiusX: 2.2 * s, radiusY: 8 * s, color: C(...accent), opacity: 0.26 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 15 * s), radiusX: 5 * s, radiusY: 5.5 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 18 * s), radiusX: 11 * s, radiusY: 3 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 18.8 * s), radiusX: 11 * s, radiusY: 1.2 * s, color: C(...accent), opacity: 0.3 });
  const tipLean = flip * 2.4;
  let tipX = ucx, tipY = ucy - 19 * s;
  for (let i = 0; i < 7; i++) {
    const f = i / 6;
    const sway = reduce ? 0 : Math.sin(t * 2 + f * 2) * f * 1.2;
    tipX = ucx + (tipLean * f + sway) * s;
    tipY = ucy - 19 * s - i * 2.7 * s;
    k.drawEllipse({ pos: k.vec2(tipX, tipY), radiusX: (6.6 - 5.6 * f) * s, radiusY: 2.6 * s, color: C(...cloak) });
  }
  k.drawEllipse({ pos: k.vec2(ucx + tipLean * 0.45 * s, ucy - 26 * s), radiusX: 3.4 * s, radiusY: 1.6 * s, color: C(...accent), opacity: 0.55 });
  const twinkle = reduce ? 0.85 : 0.55 + 0.4 * Math.sin(t * 4);
  k.drawCircle({ pos: k.vec2(tipX, tipY), radius: 2.6 * s, color: C(...accent), opacity: 0.3 });
  k.drawCircle({ pos: k.vec2(tipX, tipY), radius: 1.4 * s, color: C(...accent), opacity: twinkle });
  if (facingCamera) {
    k.drawEllipse({ pos: k.vec2(ucx, ucy - 13 * s), radiusX: 4.6 * s, radiusY: 4.6 * s, color: C(...cloakDk) });
    eyes(P, 2.0, ucy - 13 * s, 1.3);
  }
}

function automatonModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cy, ucx, ucy, fxu, flip, facingCamera, t, reduce, step } = P;
  const panel = lighten(cloak, 1.4, 14);
  k.drawRect({ pos: k.vec2(fxu(-4), cy + 13 * s - footLift(step, s, 1)), width: 5 * s, height: 11 * s, color: C(...cloakDk), anchor: "center", radius: 1 * s });
  k.drawRect({ pos: k.vec2(fxu(4), cy + 13 * s - footLift(step, s, -1)), width: 5 * s, height: 11 * s, color: C(...cloakDk), anchor: "center", radius: 1 * s });
  k.drawRect({ pos: k.vec2(ucx, cy + 2 * s), width: 20 * s, height: 21 * s, color: C(...cloak), anchor: "center", radius: 4 * s });
  k.drawRect({ pos: k.vec2(ucx, cy - 6 * s), width: 16 * s, height: 1.5 * s, color: C(...cloakDk), anchor: "center" });
  k.drawRect({ pos: k.vec2(fxu(-9), cy + 2 * s), width: 1.5 * s, height: 16 * s, color: C(...cloakDk), anchor: "center" });
  const pulse = reduce ? 0.7 : 0.5 + 0.35 * Math.sin(t * 3);
  k.drawCircle({ pos: k.vec2(ucx, cy + 2 * s), radius: 5 * s, color: C(...accent), opacity: 0.22 });
  k.drawCircle({ pos: k.vec2(ucx, cy + 2 * s), radius: 2.4 * s, color: C(...accent), opacity: pulse });
  k.drawRect({ pos: k.vec2(fxu(-11), ucy - 6 * s), width: 5 * s, height: 6 * s, color: C(...panel), anchor: "center", radius: 1.5 * s });
  k.drawRect({ pos: k.vec2(fxu(11), ucy - 6 * s), width: 5 * s, height: 6 * s, color: C(...panel), anchor: "center", radius: 1.5 * s });
  k.drawRect({ pos: k.vec2(ucx, ucy - 15 * s), width: 13 * s, height: 11 * s, color: C(...panel), anchor: "center", radius: 3 * s });
  k.drawLine({ p1: k.vec2(ucx, ucy - 20 * s), p2: k.vec2(ucx + flip * 2 * s, ucy - 26 * s), width: 1.5 * s, color: C(...cloakDk) });
  k.drawCircle({ pos: k.vec2(ucx + flip * 2 * s, ucy - 26 * s), radius: 2 * s, color: C(...accent), opacity: reduce ? 0.8 : 0.55 + 0.45 * Math.sin(t * 4.5) });
  if (facingCamera) {
    k.drawRect({ pos: k.vec2(ucx, ucy - 15 * s), width: 10 * s, height: 4 * s, color: C(...cloakDk), anchor: "center", radius: 1.5 * s });
    k.drawRect({ pos: k.vec2(ucx, ucy - 15 * s), width: 8 * s, height: 2.2 * s, color: C(...accent), anchor: "center", radius: 1 * s, opacity: 0.35 });
    k.drawRect({ pos: k.vec2(ucx, ucy - 15 * s), width: 7 * s, height: 1.4 * s, color: C(...accent), anchor: "center", radius: 0.7 * s });
  } else {
    k.drawRect({ pos: k.vec2(ucx, ucy - 16 * s), width: 9 * s, height: 1.4 * s, color: C(...cloakDk), anchor: "center", radius: 0.7 * s });
  }
}

function wispModel(P) {
  const { k, C, s, accent, cloak, cy, ucx, ucy, fxu, facingCamera, t, reduce } = P;
  [[13, 0.10], [9, 0.18]].forEach(([r, o]) =>
    k.drawCircle({ pos: k.vec2(ucx, ucy - 2 * s), radius: r * s, color: C(...accent), opacity: o }));
  for (let i = -1; i <= 1; i++) {
    const sway = (reduce ? 0 : Math.sin(t * 3 + i * 1.3)) * 2 * s;
    k.drawEllipse({ pos: k.vec2(ucx + i * 4 * s + sway, cy + 11 * s), radiusX: 2.6 * s, radiusY: 6 * s, color: C(...cloak) });
    k.drawEllipse({ pos: k.vec2(ucx + i * 4 * s + sway, cy + 14 * s), radiusX: 1.4 * s, radiusY: 3 * s, color: C(...accent), opacity: 0.4 });
  }
  k.drawEllipse({ pos: k.vec2(ucx, cy + 1 * s), radiusX: 8 * s, radiusY: 11 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(fxu(-5), cy + 1 * s), radiusX: 2.4 * s, radiusY: 7 * s, color: C(...accent), opacity: 0.3 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 11 * s), radiusX: 6 * s, radiusY: 6.5 * s, color: C(...cloak) });
  const crest = reduce ? 0 : Math.sin(t * 4) * 0.6;
  k.drawEllipse({ pos: k.vec2(fxu(-3), ucy - 18 * s - crest * s), radiusX: 1.6 * s, radiusY: 4 * s, color: C(...accent), opacity: 0.5 });
  k.drawEllipse({ pos: k.vec2(fxu(3), ucy - 18 * s + crest * s), radiusX: 1.6 * s, radiusY: 4 * s, color: C(...accent), opacity: 0.5 });
  if (facingCamera) eyes(P, 2.2, ucy - 11 * s, 1.5);
}

function wardenModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cx, cy, ucx, ucy, fxu, flip, facingCamera, t, reduce, step } = P;
  const fur = lighten(cloak, 1.35, 12);
  k.drawEllipse({ pos: k.vec2(fxu(-5), cy + 14 * s - footLift(step, s, 1)), radiusX: 3.4 * s, radiusY: 5 * s, color: C(...cloakDk) });
  k.drawEllipse({ pos: k.vec2(fxu(5), cy + 14 * s - footLift(step, s, -1)), radiusX: 3.4 * s, radiusY: 5 * s, color: C(...cloakDk) });
  k.drawEllipse({ pos: k.vec2(cx, cy + 6 * s), radiusX: 12 * s, radiusY: 13 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 2 * s), radiusX: 11 * s, radiusY: 10 * s, color: C(...cloak) });
  for (let i = -3; i <= 3; i++)
    k.drawEllipse({ pos: k.vec2(ucx + i * 3.4 * s, ucy - 6 * s + Math.abs(i) * 0.9 * s), radiusX: 3 * s, radiusY: 4 * s, color: C(...fur) });
  k.drawEllipse({ pos: k.vec2(fxu(-8), ucy - 6 * s), radiusX: 2.2 * s, radiusY: 5 * s, color: C(...accent), opacity: 0.28 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 13 * s), radiusX: 6 * s, radiusY: 5.5 * s, color: C(...cloak) });
  const hs = reduce ? 0 : Math.sin(t * 2.5) * 0.4;
  for (const side of [-1, 1])
    for (let i = 0; i < 4; i++) {
      const f = i / 3;
      k.drawEllipse({ pos: k.vec2(ucx + side * (4 + i * 1.6) * s - flip * hs * s, ucy - 16 * s - i * 2.2 * s),
        radiusX: (2.4 - 1.4 * f) * s, radiusY: 2.4 * s, color: C(...fur) });
    }
  if (facingCamera) {
    k.drawEllipse({ pos: k.vec2(ucx, ucy - 11 * s), radiusX: 3.4 * s, radiusY: 2.6 * s, color: C(...cloakDk) });
    eyes(P, 2.4, ucy - 14 * s, 1.2);
  }
}

function seraphModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cx, cy, ucx, ucy, fxu, facingCamera, hemSway, t, reduce } = P;
  const feather = lighten(cloak, 1.5, 20);
  const flap = reduce ? 0 : Math.sin(t * 2.2) * 1.4;
  for (const side of [-1, 1])
    for (let i = 0; i < 4; i++) {
      const f = i / 3;
      k.drawEllipse({ pos: k.vec2(ucx + side * (6 + i * 4) * s, ucy - 4 * s - i * 3 * s - flap * f * s),
        radiusX: (6 - 2.5 * f) * s, radiusY: (3.4 - 0.4 * i) * s, color: C(...feather), opacity: 0.9 });
    }
  k.drawEllipse({ pos: k.vec2(cx, cy + 7 * s), radiusX: 9 * s, radiusY: 15 * s, color: C(...cloak) });
  for (let i = -1; i <= 1; i++)
    k.drawRect({ pos: k.vec2(cx + i * 5 * s + hemSway * 0.4, cy + 18 * s), width: 3.6 * s, height: 6 * s, color: C(...cloakDk), anchor: "center", radius: 1 * s });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 4 * s), radiusX: 7.5 * s, radiusY: 9 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(fxu(-5), ucy - 3 * s), radiusX: 2.2 * s, radiusY: 7 * s, color: C(...accent), opacity: 0.28 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 14 * s), radiusX: 5.5 * s, radiusY: 6 * s, color: C(...cloak) });
  const hy = ucy - 22 * s + (reduce ? 0 : Math.sin(t * 2) * 0.8 * s);
  k.drawCircle({ pos: k.vec2(ucx, hy), radius: 5 * s, fill: false, outline: { width: 1.6 * s, color: C(...accent) }, opacity: 0.85 });
  if (facingCamera) eyes(P, 2.2, ucy - 14 * s, 1.3);
}

function diverModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cy, ucx, ucy, fxu, facingCamera, t, reduce, step } = P;
  const suit = lighten(cloak, 1.3, 12);
  k.drawRect({ pos: k.vec2(fxu(-4), cy + 13 * s - footLift(step, s, 1)), width: 5.5 * s, height: 11 * s, color: C(...cloakDk), anchor: "center", radius: 2 * s });
  k.drawRect({ pos: k.vec2(fxu(4), cy + 13 * s - footLift(step, s, -1)), width: 5.5 * s, height: 11 * s, color: C(...cloakDk), anchor: "center", radius: 2 * s });
  k.drawEllipse({ pos: k.vec2(ucx, cy + 1 * s), radiusX: 11 * s, radiusY: 12 * s, color: C(...suit) });
  k.drawEllipse({ pos: k.vec2(fxu(-7), cy + 1 * s), radiusX: 2.2 * s, radiusY: 7 * s, color: C(...accent), opacity: 0.26 });
  k.drawCircle({ pos: k.vec2(ucx, cy + 1 * s), radius: 2.6 * s, color: C(...cloakDk) });
  k.drawCircle({ pos: k.vec2(ucx, cy + 1 * s), radius: 1.2 * s, color: C(...accent), opacity: 0.7 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 8 * s), radiusX: 6 * s, radiusY: 2.4 * s, color: C(...suit) });
  k.drawCircle({ pos: k.vec2(ucx, ucy - 14 * s), radius: 7.5 * s, color: C(...cloak) });
  k.drawCircle({ pos: k.vec2(ucx, ucy - 14 * s), radius: 7.5 * s, fill: false, outline: { width: 1.5 * s, color: C(...accent) }, opacity: 0.6 });
  k.drawCircle({ pos: k.vec2(fxu(-3), ucy - 16 * s), radius: 2 * s, color: C(...accent), opacity: 0.3 });
  if (!reduce)
    for (let i = 0; i < 3; i++) {
      const bp = (t * 0.6 + i * 0.33) % 1;
      k.drawCircle({ pos: k.vec2(fxu(7) + Math.sin(bp * 6) * 1.5 * s, ucy - 14 * s - bp * 16 * s), radius: Math.max(0.3, (1.6 - bp) * s), color: C(...accent), opacity: 0.4 * (1 - bp) });
    }
  if (facingCamera) eyes(P, 2.2, ucy - 14 * s, 1.3);
}

function monarchModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cx, cy, ucx, ucy, fxu, flip, facingCamera, hemSway, t, reduce } = P;
  const trim = lighten(cloak, 1.6, 20);
  const capeX = ucx - flip * 3 * s;
  k.drawEllipse({ pos: k.vec2(capeX, cy + 7 * s), radiusX: 13 * s, radiusY: 15 * s, color: C(...cloakDk) });
  for (let i = -2; i <= 2; i++)
    k.drawRect({ pos: k.vec2(capeX + i * 5 * s + hemSway * 0.5, cy + 19 * s), width: 4.4 * s, height: (6 + Math.abs(i)) * s, color: C(...cloakDk), anchor: "center", radius: 1 * s });
  k.drawEllipse({ pos: k.vec2(cx, cy + 6 * s), radiusX: 10 * s, radiusY: 14 * s, color: C(...cloak) });
  k.drawRect({ pos: k.vec2(cx, cy + 8 * s), width: 2.4 * s, height: 16 * s, color: C(...accent), anchor: "center", opacity: 0.4, radius: 1 * s });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 4 * s), radiusX: 8 * s, radiusY: 9 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(fxu(-6), ucy - 8 * s), radiusX: 2.4 * s, radiusY: 5 * s, color: C(...trim) });
  k.drawEllipse({ pos: k.vec2(fxu(6), ucy - 8 * s), radiusX: 2.4 * s, radiusY: 5 * s, color: C(...trim) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 14 * s), radiusX: 5.5 * s, radiusY: 6 * s, color: C(...cloak) });
  k.drawRect({ pos: k.vec2(ucx, ucy - 18 * s), width: 12 * s, height: 3 * s, color: C(...trim), anchor: "center", radius: 1 * s });
  for (let i = -1; i <= 1; i++) {
    k.drawEllipse({ pos: k.vec2(ucx + i * 4 * s, ucy - 21 * s), radiusX: 1.8 * s, radiusY: 3 * s, color: C(...trim) });
    k.drawCircle({ pos: k.vec2(ucx + i * 4 * s, ucy - 22 * s), radius: 1.2 * s, color: C(...accent), opacity: reduce ? 0.8 : 0.55 + 0.4 * Math.sin(t * 3 + i) });
  }
  if (facingCamera) eyes(P, 2.2, ucy - 14 * s, 1.3);
}

function corvidModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cx, cy, ucx, ucy, fxu, facingCamera, hemSway } = P;
  k.drawEllipse({ pos: k.vec2(cx, cy + 7 * s), radiusX: 10 * s, radiusY: 16 * s, color: C(...cloak) });
  for (let i = -2; i <= 2; i++)
    k.drawRect({ pos: k.vec2(cx + i * 4.4 * s + hemSway * 0.4, cy + 19 * s), width: 3.6 * s, height: 7 * s, color: C(...cloakDk), anchor: "center", radius: 1 * s });
  for (let i = 0; i < 3; i++) k.drawCircle({ pos: k.vec2(cx, cy + (i * 4 - 2) * s), radius: 1 * s, color: C(...accent), opacity: 0.5 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 4 * s), radiusX: 8 * s, radiusY: 9 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(fxu(-6), ucy - 3 * s), radiusX: 2.2 * s, radiusY: 7 * s, color: C(...accent), opacity: 0.26 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 14 * s), radiusX: 5.5 * s, radiusY: 6 * s, color: C(...cloakDk) });
  const beak = lighten(cloak, 1.9, 26);
  for (let i = 0; i < 5; i++) {
    const f = i / 4;
    k.drawEllipse({ pos: k.vec2(fxu(2 + i * 1.7), ucy - 13 * s + i * 1.4 * s), radiusX: (2.8 - 2.1 * f) * s, radiusY: (2.6 - 1.5 * f) * s, color: C(...beak) });
  }
  k.drawCircle({ pos: k.vec2(fxu(9), ucy - 7.5 * s), radius: 1 * s, color: C(...accent), opacity: 0.7 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 18 * s), radiusX: 10 * s, radiusY: 2.6 * s, color: C(...lighten(cloak, 1.3, 10)) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 20 * s), radiusX: 5 * s, radiusY: 4 * s, color: C(...lighten(cloak, 1.3, 10)) });
  if (facingCamera) {
    k.drawCircle({ pos: k.vec2(fxu(-2.6), ucy - 14 * s), radius: 2.2 * s, color: C(...accent), opacity: 0.3 });
    k.drawCircle({ pos: k.vec2(fxu(2.6), ucy - 14 * s), radius: 2.2 * s, color: C(...accent), opacity: 0.3 });
    k.drawCircle({ pos: k.vec2(fxu(-2.6), ucy - 14 * s), radius: 1.1 * s, color: C(...accent) });
    k.drawCircle({ pos: k.vec2(fxu(2.6), ucy - 14 * s), radius: 1.1 * s, color: C(...accent) });
  }
}

function roninModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cx, cy, ucx, ucy, fxu, flip, facingCamera, hemSway } = P;
  const cloth = lighten(cloak, 1.4, 14);
  k.drawEllipse({ pos: k.vec2(cx, cy + 7 * s), radiusX: 11 * s, radiusY: 15 * s, color: C(...cloak) });
  k.drawRect({ pos: k.vec2(cx, cy + 12 * s), width: 1.6 * s, height: 14 * s, color: C(...cloakDk), anchor: "center" });
  for (let i = -1; i <= 1; i++)
    k.drawRect({ pos: k.vec2(cx + i * 6 * s + hemSway * 0.4, cy + 19 * s), width: 5 * s, height: 6 * s, color: C(...cloakDk), anchor: "center", radius: 1 * s });
  const sgx = cx - flip * 9 * s;
  k.drawLine({ p1: k.vec2(sgx, cy + 2 * s), p2: k.vec2(sgx - flip * 8 * s, cy + 14 * s), width: 2.4 * s, color: C(...cloth) });
  k.drawCircle({ pos: k.vec2(sgx, cy + 2 * s), radius: 1.6 * s, color: C(...accent), opacity: 0.8 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 4 * s), radiusX: 8.5 * s, radiusY: 10 * s, color: C(...cloak) });
  k.drawRect({ pos: k.vec2(ucx, cy - 3 * s), width: 16 * s, height: 3.2 * s, color: C(...accent), anchor: "center", opacity: 0.55, radius: 1 * s });
  k.drawEllipse({ pos: k.vec2(fxu(-6), ucy - 4 * s), radiusX: 2.2 * s, radiusY: 7 * s, color: C(...accent), opacity: 0.26 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 14 * s), radiusX: 5 * s, radiusY: 5.5 * s, color: C(...cloak) });
  k.drawCircle({ pos: k.vec2(ucx, ucy - 20 * s), radius: 1.6 * s, color: C(...cloakDk) });
  for (let i = 0; i < 4; i++) {
    const f = i / 3;
    k.drawEllipse({ pos: k.vec2(ucx, ucy - 16 * s - i * 1.7 * s), radiusX: (12 - 8 * f) * s, radiusY: (3.4 - 1.6 * f) * s, color: C(...cloth) });
  }
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 16.4 * s), radiusX: 12 * s, radiusY: 1.2 * s, color: C(...accent), opacity: 0.3 });
  if (facingCamera) {
    k.drawEllipse({ pos: k.vec2(ucx, ucy - 13 * s), radiusX: 4.6 * s, radiusY: 3 * s, color: C(...cloakDk) });
    eyes(P, 2.0, ucy - 13 * s, 1.2);
  }
}

function golemModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cy, ucx, ucy, fxu, facingCamera, t, reduce, step } = P;
  const rock = lighten(cloak, 1.4, 16);
  k.drawEllipse({ pos: k.vec2(fxu(-5), cy + 14 * s - footLift(step, s, 1)), radiusX: 4 * s, radiusY: 4 * s, color: C(...cloakDk) });
  k.drawEllipse({ pos: k.vec2(fxu(5), cy + 14 * s - footLift(step, s, -1)), radiusX: 4 * s, radiusY: 4 * s, color: C(...cloakDk) });
  k.drawEllipse({ pos: k.vec2(ucx, cy + 2 * s), radiusX: 13 * s, radiusY: 14 * s, color: C(...cloak) });
  k.drawLine({ p1: k.vec2(fxu(-6), cy - 6 * s), p2: k.vec2(fxu(-3), cy + 6 * s), width: 1.4 * s, color: C(...cloakDk) });
  k.drawLine({ p1: k.vec2(fxu(7), cy - 4 * s), p2: k.vec2(fxu(3), cy + 8 * s), width: 1.4 * s, color: C(...cloakDk) });
  const pulse = reduce ? 0.7 : 0.5 + 0.4 * Math.sin(t * 2.6);
  k.drawCircle({ pos: k.vec2(ucx, cy + 2 * s), radius: 5.5 * s, color: C(...accent), opacity: 0.2 });
  k.drawCircle({ pos: k.vec2(ucx, cy + 2 * s), radius: 2.6 * s, color: C(...accent), opacity: pulse });
  k.drawEllipse({ pos: k.vec2(fxu(-11), ucy - 5 * s), radiusX: 5.5 * s, radiusY: 5 * s, color: C(...rock) });
  k.drawEllipse({ pos: k.vec2(fxu(11), ucy - 5 * s), radiusX: 5.5 * s, radiusY: 5 * s, color: C(...rock) });
  k.drawEllipse({ pos: k.vec2(fxu(-11), ucy - 7 * s), radiusX: 5 * s, radiusY: 1.6 * s, color: C(...accent), opacity: 0.35 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 12 * s), radiusX: 6.5 * s, radiusY: 6 * s, color: C(...rock) });
  if (!reduce)
    for (let i = 0; i < 3; i++) {
      const a = t * 0.9 + i * 2.1;
      k.drawEllipse({ pos: k.vec2(ucx + Math.cos(a) * 15 * s, (cy - 2 * s) + Math.sin(a) * 9 * s), radiusX: 1.4 * s, radiusY: 2.6 * s, color: C(...accent), opacity: 0.8 });
    }
  if (facingCamera) eyes(P, 2.4, ucy - 12 * s, 1.3);
}

function nagaModel(P) {
  const { k, C, s, accent, cloak, cx, cy, ucx, ucy, fxu, facingCamera, t, reduce } = P;
  const scale = lighten(cloak, 1.45, 16);
  for (let i = 0; i < 4; i++) {
    const f = i / 3;
    k.drawEllipse({ pos: k.vec2(cx + Math.sin(i * 1.6) * 3 * s, cy + (16 - i * 4) * s), radiusX: (12 - 5 * f) * s, radiusY: (5 - 1.5 * f) * s, color: C(...cloak) });
  }
  for (let i = 0; i < 3; i++)
    k.drawEllipse({ pos: k.vec2(cx, cy + (13 - i * 4) * s), radiusX: 2.2 * s, radiusY: 1.2 * s, color: C(...scale), opacity: 0.7 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 3 * s), radiusX: 7.5 * s, radiusY: 9 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(fxu(-5), ucy - 3 * s), radiusX: 2.2 * s, radiusY: 7 * s, color: C(...accent), opacity: 0.26 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 13 * s), radiusX: 10 * s, radiusY: 8 * s, color: C(...scale) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 13 * s), radiusX: 10 * s, radiusY: 8 * s, fill: false, outline: { width: 1.4 * s, color: C(...accent) }, opacity: 0.4 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 14 * s), radiusX: 5 * s, radiusY: 5.5 * s, color: C(...cloak) });
  if (facingCamera) {
    if (!reduce && Math.sin(t * 6) > 0.4)
      k.drawLine({ p1: k.vec2(fxu(0), ucy - 11 * s), p2: k.vec2(fxu(0), ucy - 7 * s), width: 1 * s, color: C(...accent) });
    eyes(P, 2.0, ucy - 14 * s, 1.2);
  }
}

function jesterModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cx, cy, ucx, ucy, facingCamera, hemSway, t, reduce } = P;
  const motley = lighten(cloak, 1.5, 18);
  k.drawEllipse({ pos: k.vec2(cx, cy + 6 * s), radiusX: 11 * s, radiusY: 14 * s, color: C(...cloak) });
  k.drawRect({ pos: k.vec2(cx, cy + 8 * s), width: 2.4 * s, height: 15 * s, color: C(...accent), anchor: "center", opacity: 0.4, radius: 1 * s });
  for (let i = -2; i <= 2; i++) {
    const px = cx + i * 5 * s + hemSway * 0.4;
    k.drawEllipse({ pos: k.vec2(px, cy + 18 * s), radiusX: 2.4 * s, radiusY: 4 * s, color: C(...(i % 2 ? motley : cloakDk)) });
    k.drawCircle({ pos: k.vec2(px, cy + 22 * s), radius: 1.4 * s, color: C(...accent), opacity: 0.85 });
  }
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 4 * s), radiusX: 7.5 * s, radiusY: 9 * s, color: C(...cloak) });
  for (let i = -3; i <= 3; i++)
    k.drawCircle({ pos: k.vec2(ucx + i * 2.4 * s, ucy - 8 * s + Math.abs(i) * 0.5 * s), radius: 2 * s, color: C(...motley) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 14 * s), radiusX: 5 * s, radiusY: 5.5 * s, color: C(...cloak) });
  for (const side of [-1, 1]) {
    const droop = reduce ? 0 : Math.sin(t * 3 + (side > 0 ? 1.5 : 0)) * 1.2;
    let hx = ucx, hy = ucy - 18 * s;
    for (let i = 0; i < 4; i++) {
      const f = i / 3;
      hx = ucx + side * (3 + i * 3) * s;
      hy = ucy - 19 * s + i * 1.4 * s + droop * f * s;
      k.drawEllipse({ pos: k.vec2(hx, hy), radiusX: (3 - 1.6 * f) * s, radiusY: (3 - 1.4 * f) * s, color: C(...(i % 2 ? motley : cloak)) });
    }
    k.drawCircle({ pos: k.vec2(hx, hy), radius: 1.6 * s, color: C(...accent), opacity: 0.9 });
  }
  if (facingCamera) eyes(P, 2.0, ucy - 14 * s, 1.2);
}

function treantModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cx, cy, ucx, ucy, facingCamera, t, reduce } = P;
  const moss = lighten(cloak, 1.4, 14);
  for (let i = -2; i <= 2; i++)
    k.drawLine({ p1: k.vec2(cx, cy + 12 * s), p2: k.vec2(cx + i * 5 * s, cy + 17 * s), width: 2.2 * s, color: C(...cloakDk) });
  k.drawEllipse({ pos: k.vec2(cx, cy + 4 * s), radiusX: 9 * s, radiusY: 15 * s, color: C(...cloak) });
  k.drawLine({ p1: k.vec2(cx - 2 * s, cy - 6 * s), p2: k.vec2(cx + 1 * s, cy + 10 * s), width: 1.2 * s, color: C(...cloakDk) });
  const glow = reduce ? 0.6 : 0.45 + 0.3 * Math.sin(t * 2.2);
  k.drawCircle({ pos: k.vec2(ucx, cy), radius: 3.6 * s, color: C(...accent), opacity: 0.18 });
  k.drawCircle({ pos: k.vec2(ucx, cy), radius: 1.8 * s, color: C(...accent), opacity: glow });
  for (let i = -2; i <= 2; i++)
    k.drawEllipse({ pos: k.vec2(ucx + i * 4 * s, ucy - 6 * s - Math.abs(i) * 0.5 * s), radiusX: 3.4 * s, radiusY: 3 * s, color: C(...moss) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 12 * s), radiusX: 5.5 * s, radiusY: 5.5 * s, color: C(...cloak) });
  for (const side of [-1, 1]) {
    const sway = reduce ? 0 : Math.sin(t * 1.8 + (side > 0 ? 1 : 0)) * 0.6;
    for (let i = 0; i < 3; i++) {
      const bx = ucx + side * (2 + i * 2.2) * s + sway * s;
      const by = ucy - 16 * s - i * 2.4 * s;
      k.drawLine({ p1: k.vec2(ucx + side * 1.5 * s, ucy - 15 * s), p2: k.vec2(bx, by), width: 1.4 * s, color: C(...cloakDk) });
      k.drawCircle({ pos: k.vec2(bx, by), radius: 2 * s, color: C(...moss) });
      k.drawCircle({ pos: k.vec2(bx, by), radius: 1 * s, color: C(...accent), opacity: 0.5 });
    }
  }
  if (facingCamera) eyes(P, 2.0, ucy - 12 * s, 1.2);
}

function lichModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cx, cy, ucx, ucy, fxu, facingCamera, hemSway, t, reduce } = P;
  const bone = lighten(cloak, 2.0, 70);
  k.drawEllipse({ pos: k.vec2(cx, cy + 7 * s), radiusX: 11 * s, radiusY: 16 * s, color: C(...cloak) });
  for (let i = -2; i <= 2; i++) {
    const hh = (6 + (Math.abs(i) % 2) * 4) * s;
    k.drawRect({ pos: k.vec2(cx + i * 4.6 * s + hemSway * 0.4, cy + 19 * s), width: 3.6 * s, height: hh, color: C(...cloakDk), anchor: "center", radius: 1 * s });
  }
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 4 * s), radiusX: 9 * s, radiusY: 10 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(fxu(-6), ucy - 4 * s), radiusX: 2.2 * s, radiusY: 7 * s, color: C(...accent), opacity: 0.26 });
  for (const side of [-1, 1])
    k.drawEllipse({ pos: k.vec2(fxu(side * 9), ucy - 8 * s), radiusX: 2.4 * s, radiusY: 1.6 * s, color: C(...bone) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 15 * s), radiusX: 7.5 * s, radiusY: 8 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 20 * s), radiusX: 4.5 * s, radiusY: 5 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 14 * s), radiusX: 4.6 * s, radiusY: 5 * s, color: C(...bone) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 11 * s), radiusX: 3.2 * s, radiusY: 2.4 * s, color: C(...bone) });
  if (!reduce)
    for (let i = 0; i < 2; i++) {
      const a = t * 0.8 + i * Math.PI;
      k.drawCircle({ pos: k.vec2(ucx + Math.cos(a) * 14 * s, (ucy - 6 * s) + Math.sin(a) * 6 * s), radius: 1.8 * s, color: C(...bone), opacity: 0.85 });
    }
  if (facingCamera) {
    eyes(P, 1.7, ucy - 14.5 * s, 1.2);
    k.drawEllipse({ pos: k.vec2(ucx, ucy - 12.5 * s), radiusX: 0.7 * s, radiusY: 1.2 * s, color: C(...cloakDk) });
  }
}

function anubisModel(P) {
  const { k, C, s, accent, cloak, cx, cy, ucx, ucy, fxu, flip, facingCamera } = P;
  const gold = lighten(cloak, 1.7, 30);
  k.drawEllipse({ pos: k.vec2(cx, cy + 7 * s), radiusX: 10 * s, radiusY: 14 * s, color: C(...cloak) });
  k.drawRect({ pos: k.vec2(cx, cy + 10 * s), width: 14 * s, height: 3 * s, color: C(...accent), anchor: "center", opacity: 0.5, radius: 1 * s });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 4 * s), radiusX: 8 * s, radiusY: 9 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 7 * s), radiusX: 9 * s, radiusY: 3 * s, color: C(...gold) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 6 * s), radiusX: 9 * s, radiusY: 1.4 * s, color: C(...accent), opacity: 0.4 });
  for (const side of [-1, 1])
    k.drawRect({ pos: k.vec2(fxu(side * 5.5), ucy - 12 * s), width: 3.2 * s, height: 9 * s, color: C(...gold), anchor: "center", radius: 1 * s });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 14 * s), radiusX: 5 * s, radiusY: 5.5 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(fxu(3), ucy - 12.5 * s), radiusX: 3.2 * s, radiusY: 1.8 * s, color: C(...cloak) });
  for (const side of [-1, 1])
    k.drawEllipse({ pos: k.vec2(ucx + side * 3.4 * s, ucy - 21 * s), radiusX: 1.8 * s, radiusY: 4.5 * s, color: C(...cloak) });
  const stx = cx - flip * 11 * s;
  k.drawLine({ p1: k.vec2(stx, ucy - 18 * s), p2: k.vec2(stx, cy + 14 * s), width: 1.6 * s, color: C(...gold) });
  k.drawCircle({ pos: k.vec2(stx, ucy - 20 * s), radius: 2 * s, fill: false, outline: { width: 1.2 * s, color: C(...accent) } });
  if (facingCamera) eyes(P, 2.0, ucy - 14 * s, 1.1);
}

function myconidModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cy, ucx, ucy, fxu, facingCamera, t, reduce, step } = P;
  const cap = lighten(cloak, 1.5, 18);
  const stalk = lighten(cloak, 1.8, 40);
  k.drawEllipse({ pos: k.vec2(fxu(-3.5), cy + 14 * s - footLift(step, s, 1)), radiusX: 2.8 * s, radiusY: 3 * s, color: C(...cloakDk) });
  k.drawEllipse({ pos: k.vec2(fxu(3.5), cy + 14 * s - footLift(step, s, -1)), radiusX: 2.8 * s, radiusY: 3 * s, color: C(...cloakDk) });
  k.drawEllipse({ pos: k.vec2(ucx, cy + 3 * s), radiusX: 7.5 * s, radiusY: 11 * s, color: C(...stalk) });
  k.drawEllipse({ pos: k.vec2(fxu(-4), cy + 3 * s), radiusX: 1.8 * s, radiusY: 6 * s, color: C(...accent), opacity: 0.22 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 8 * s), radiusX: 9 * s, radiusY: 2.4 * s, color: C(...cloakDk) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 12 * s), radiusX: 12 * s, radiusY: 8 * s, color: C(...cap) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 14 * s), radiusX: 9 * s, radiusY: 5 * s, color: C(...cloak) });
  for (let i = -1; i <= 1; i++)
    k.drawCircle({ pos: k.vec2(ucx + i * 5 * s, ucy - 14 * s - Math.abs(i) * 0.6 * s), radius: 1.6 * s, color: C(...accent), opacity: 0.6 });
  if (!reduce)
    for (let i = 0; i < 3; i++) {
      const sp = (t * 0.4 + i * 0.33) % 1;
      k.drawCircle({ pos: k.vec2(fxu(8) + Math.sin(sp * 6 + i) * 2 * s, ucy - 10 * s + sp * 14 * s), radius: Math.max(0.3, 1.2 * (1 - sp) * s), color: C(...accent), opacity: 0.35 * (1 - sp) });
    }
  if (facingCamera) eyes(P, 2.0, cy - 1 * s, 1.2);
}

function anglerModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cy, ucx, ucy, fxu, flip, facingCamera, t, reduce, step } = P;
  const hide = lighten(cloak, 1.4, 16);
  k.drawEllipse({ pos: k.vec2(fxu(-5), cy + 14 * s - footLift(step, s, 1)), radiusX: 4 * s, radiusY: 3 * s, color: C(...cloakDk) });
  k.drawEllipse({ pos: k.vec2(fxu(5), cy + 14 * s - footLift(step, s, -1)), radiusX: 4 * s, radiusY: 3 * s, color: C(...cloakDk) });
  k.drawEllipse({ pos: k.vec2(ucx, cy + 3 * s), radiusX: 12 * s, radiusY: 13 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(fxu(-7), cy + 2 * s), radiusX: 2.2 * s, radiusY: 7 * s, color: C(...accent), opacity: 0.24 });
  for (let i = 0; i < 3; i++)
    k.drawEllipse({ pos: k.vec2(ucx - flip * (2 + i * 2) * s, ucy - 4 * s - i * 1.5 * s), radiusX: 1.4 * s, radiusY: (4 - i) * s, color: C(...hide), opacity: 0.8 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 10 * s), radiusX: 7.5 * s, radiusY: 6 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 8 * s), radiusX: 6.5 * s, radiusY: 2.2 * s, color: C(...hide) });
  for (let i = -2; i <= 2; i++)
    k.drawEllipse({ pos: k.vec2(ucx + i * 2.4 * s, ucy - 7 * s), radiusX: 0.6 * s, radiusY: 1.4 * s, color: C(255, 255, 255), opacity: 0.7 });
  const lx = ucx + flip * 2 * s, ly = ucy - 22 * s;
  k.drawLine({ p1: k.vec2(ucx, ucy - 13 * s), p2: k.vec2(ucx + flip * 1 * s, ucy - 18 * s), width: 1.4 * s, color: C(...hide) });
  k.drawLine({ p1: k.vec2(ucx + flip * 1 * s, ucy - 18 * s), p2: k.vec2(lx, ly), width: 1.4 * s, color: C(...hide) });
  const glow = reduce ? 0.8 : 0.55 + 0.4 * Math.sin(t * 3);
  k.drawCircle({ pos: k.vec2(lx, ly), radius: 4 * s, color: C(...accent), opacity: 0.2 });
  k.drawCircle({ pos: k.vec2(lx, ly), radius: 2 * s, color: C(...accent), opacity: glow });
  if (facingCamera) eyes(P, 3.0, ucy - 11 * s, 1.4);
}

function scarecrowModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cx, cy, ucx, ucy, fxu, facingCamera, hemSway, step } = P;
  const sack = lighten(cloak, 1.6, 34);
  const straw = lighten(cloak, 1.7, 46);
  k.drawRect({ pos: k.vec2(fxu(-4), cy + 12 * s - footLift(step, s, 1)), width: 4 * s, height: 13 * s, color: C(...cloakDk), anchor: "center", radius: 1 * s });
  k.drawRect({ pos: k.vec2(fxu(4), cy + 12 * s - footLift(step, s, -1)), width: 4 * s, height: 13 * s, color: C(...cloakDk), anchor: "center", radius: 1 * s });
  k.drawEllipse({ pos: k.vec2(cx, cy + 4 * s), radiusX: 9 * s, radiusY: 12 * s, color: C(...cloak) });
  for (let i = -1; i <= 1; i++)
    k.drawRect({ pos: k.vec2(cx + i * 5 * s + hemSway * 0.4, cy + 14 * s), width: 3 * s, height: 5 * s, color: C(...cloakDk), anchor: "center" });
  k.drawRect({ pos: k.vec2(ucx, ucy - 4 * s), width: 26 * s, height: 2.4 * s, color: C(...cloakDk), anchor: "center", radius: 1 * s });
  for (const side of [-1, 1])
    k.drawEllipse({ pos: k.vec2(ucx + side * 13 * s, ucy - 4 * s), radiusX: 2 * s, radiusY: 3 * s, color: C(...straw) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 4 * s), radiusX: 6 * s, radiusY: 7 * s, color: C(...cloak) });
  for (let i = -2; i <= 2; i++)
    k.drawEllipse({ pos: k.vec2(ucx + i * 2 * s, ucy - 9 * s), radiusX: 1.4 * s, radiusY: 2.6 * s, color: C(...straw) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 14 * s), radiusX: 5.5 * s, radiusY: 6 * s, color: C(...sack) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 18 * s), radiusX: 8 * s, radiusY: 2 * s, color: C(...cloakDk) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 21 * s), radiusX: 3.5 * s, radiusY: 4 * s, color: C(...cloakDk) });
  if (facingCamera) {
    for (const side of [-1, 1]) {
      k.drawLine({ p1: k.vec2(fxu(side * 2 - 1), ucy - 15 * s), p2: k.vec2(fxu(side * 2 + 1), ucy - 13 * s), width: 1 * s, color: C(...accent) });
      k.drawLine({ p1: k.vec2(fxu(side * 2 - 1), ucy - 13 * s), p2: k.vec2(fxu(side * 2 + 1), ucy - 15 * s), width: 1 * s, color: C(...accent) });
    }
  }
}

function centaurModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cx, cy, ucx, ucy, fxu, flip, facingCamera, hemSway } = P;
  const coat = lighten(cloak, 1.35, 12);
  const front = flip;
  for (const [ox, back] of [[10, 0], [5, 0], [-6, 1], [-11, 1]])
    k.drawRect({ pos: k.vec2(fxu(ox), cy + 12 * s), width: 3.4 * s, height: 11 * s, color: C(...(back ? cloakDk : cloak)), anchor: "center", radius: 1 * s });
  k.drawEllipse({ pos: k.vec2(cx, cy + 4 * s), radiusX: 15 * s, radiusY: 8 * s, color: C(...coat) });
  k.drawEllipse({ pos: k.vec2(fxu(-13), cy + 4 * s), radiusX: 3 * s, radiusY: 6 * s, color: C(...accent), opacity: 0.2 });
  for (let i = 0; i < 3; i++)
    k.drawEllipse({ pos: k.vec2(cx - front * (14 + i) * s + hemSway * 0.3, cy + (5 + i * 3) * s), radiusX: 1.8 * s, radiusY: (4 - i) * s, color: C(...cloakDk) });
  const tx = ucx + front * 7 * s;
  k.drawEllipse({ pos: k.vec2(tx, ucy - 4 * s), radiusX: 6.5 * s, radiusY: 9 * s, color: C(...cloak) });
  k.drawRect({ pos: k.vec2(tx, ucy - 4 * s), width: 12 * s, height: 2.4 * s, color: C(...accent), anchor: "center", opacity: 0.5, radius: 1 * s });
  k.drawEllipse({ pos: k.vec2(tx - front * 4 * s, ucy - 3 * s), radiusX: 2 * s, radiusY: 6 * s, color: C(...accent), opacity: 0.26 });
  k.drawEllipse({ pos: k.vec2(tx, ucy - 13 * s), radiusX: 4.6 * s, radiusY: 5 * s, color: C(...cloak) });
  if (facingCamera) eyesAt(P, tx, 1.8, ucy - 13 * s, 1.2);
}

function gorgonModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cx, cy, ucx, ucy, fxu, facingCamera, hemSway, t, reduce } = P;
  const snake = lighten(cloak, 1.4, 16);
  k.drawEllipse({ pos: k.vec2(cx, cy + 7 * s), radiusX: 10 * s, radiusY: 15 * s, color: C(...cloak) });
  for (let i = -2; i <= 2; i++)
    k.drawRect({ pos: k.vec2(cx + i * 4.4 * s + hemSway * 0.4, cy + 19 * s), width: 3.4 * s, height: 6 * s, color: C(...cloakDk), anchor: "center", radius: 1 * s });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 4 * s), radiusX: 8 * s, radiusY: 9 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(fxu(-6), ucy - 3 * s), radiusX: 2.2 * s, radiusY: 7 * s, color: C(...accent), opacity: 0.26 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 14 * s), radiusX: 5 * s, radiusY: 5.5 * s, color: C(...cloak) });
  const N = 7, hx = ucx, hy = ucy - 15 * s;
  for (let i = 0; i < N; i++) {
    const a = -Math.PI + (i / (N - 1)) * Math.PI + (reduce ? 0 : Math.sin(t * 3 + i) * 0.22);
    const x1 = hx + Math.cos(a) * 6 * s, y1 = hy + Math.sin(a) * 6 * s;
    const x2 = hx + Math.cos(a) * 11 * s, y2 = hy + Math.sin(a) * 11 * s;
    k.drawLine({ p1: k.vec2(x1, y1), p2: k.vec2(x2, y2), width: 1.6 * s, color: C(...snake) });
    k.drawCircle({ pos: k.vec2(x2, y2), radius: 1.4 * s, color: C(...snake) });
    k.drawCircle({ pos: k.vec2(x2, y2), radius: 0.6 * s, color: C(...accent), opacity: 0.7 });
  }
  if (facingCamera) eyes(P, 1.9, ucy - 14 * s, 1.2);
}

function djinnModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cy, ucx, ucy, fxu, facingCamera, t, reduce } = P;
  const smoke = lighten(cloak, 1.3, 10);
  k.drawCircle({ pos: k.vec2(ucx, ucy - 4 * s), radius: 13 * s, color: C(...accent), opacity: 0.08 });
  for (let i = 0; i < 4; i++) {
    const f = i / 3;
    const sway = (reduce ? 0 : Math.sin(t * 2.5 + i)) * (2 + i) * s;
    k.drawEllipse({ pos: k.vec2(ucx + sway, cy + (16 - i * 3) * s), radiusX: (8 - 5 * f) * s, radiusY: (5 - 1.2 * f) * s, color: C(...smoke), opacity: 0.5 + 0.12 * i });
  }
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 4 * s), radiusX: 11 * s, radiusY: 9 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(fxu(-8), ucy - 4 * s), radiusX: 2.2 * s, radiusY: 6 * s, color: C(...accent), opacity: 0.26 });
  k.drawRect({ pos: k.vec2(ucx, ucy - 2 * s), width: 18 * s, height: 3 * s, color: C(...cloakDk), anchor: "center", radius: 1.5 * s });
  k.drawCircle({ pos: k.vec2(ucx, ucy), radius: 1.6 * s, color: C(...accent), opacity: 0.6 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 13 * s), radiusX: 5 * s, radiusY: 5.5 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 16 * s), radiusX: 6.5 * s, radiusY: 3.4 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 18 * s), radiusX: 5 * s, radiusY: 3.4 * s, color: C(...cloak) });
  k.drawCircle({ pos: k.vec2(ucx, ucy - 19 * s), radius: 1.4 * s, color: C(...accent), opacity: reduce ? 0.8 : 0.55 + 0.4 * Math.sin(t * 3) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 22 * s), radiusX: 1.2 * s, radiusY: 3 * s, color: C(...accent), opacity: 0.6 });
  if (facingCamera) eyes(P, 2.0, ucy - 13 * s, 1.2);
}

function pumpkinModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cx, cy, ucx, ucy, fxu, flip, facingCamera, hemSway, t, reduce } = P;
  const gourd = lighten(cloak, 1.6, 30);
  k.drawEllipse({ pos: k.vec2(cx, cy + 7 * s), radiusX: 11 * s, radiusY: 15 * s, color: C(...cloak) });
  for (let i = -2; i <= 2; i++) {
    const hh = (5 + (Math.abs(i) % 2) * 4) * s;
    k.drawRect({ pos: k.vec2(cx + i * 4.6 * s + hemSway * 0.4, cy + 19 * s), width: 3.6 * s, height: hh, color: C(...cloakDk), anchor: "center", radius: 1 * s });
  }
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 4 * s), radiusX: 8 * s, radiusY: 9 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(fxu(-6), ucy - 3 * s), radiusX: 2.2 * s, radiusY: 7 * s, color: C(...accent), opacity: 0.26 });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 14 * s), radiusX: 7.5 * s, radiusY: 6.5 * s, color: C(...gourd) });
  for (const ox of [-4, 0, 4])
    k.drawEllipse({ pos: k.vec2(ucx + ox * s, ucy - 14 * s), radiusX: 2.2 * s, radiusY: 6.2 * s, color: C(...cloakDk), opacity: 0.22 });
  k.drawRect({ pos: k.vec2(ucx + flip * 1 * s, ucy - 20 * s), width: 1.6 * s, height: 3 * s, color: C(...cloakDk), anchor: "center" });
  if (facingCamera) {
    const lit = reduce ? 0.8 : 0.6 + 0.35 * Math.sin(t * 3);
    for (const sx of [-1, 1]) {
      k.drawEllipse({ pos: k.vec2(fxu(sx * 2.8), ucy - 15 * s), radiusX: 1.6 * s, radiusY: 1.8 * s, color: C(...accent), opacity: 0.3 });
      k.drawEllipse({ pos: k.vec2(fxu(sx * 2.8), ucy - 15 * s), radiusX: 1.0 * s, radiusY: 1.2 * s, color: C(...accent), opacity: lit });
    }
    k.drawEllipse({ pos: k.vec2(ucx, ucy - 12.5 * s), radiusX: 0.8 * s, radiusY: 1.4 * s, color: C(...accent), opacity: lit });
    for (let i = -2; i <= 2; i++)
      k.drawEllipse({ pos: k.vec2(fxu(i * 1.8), ucy - 11 * s), radiusX: 0.7 * s, radiusY: (i % 2 ? 1.6 : 0.9) * s, color: C(...accent), opacity: lit });
  }
}

function mantisModel(P) {
  const { k, C, s, accent, cloak, cloakDk, cy, ucx, ucy, fxu, facingCamera, t, reduce } = P;
  const chitin = lighten(cloak, 1.45, 16);
  for (const ox of [-5, -1, 4]) {
    k.drawLine({ p1: k.vec2(fxu(ox), cy + 2 * s), p2: k.vec2(fxu(ox - 3), cy + 8 * s), width: 1.4 * s, color: C(...cloakDk) });
    k.drawLine({ p1: k.vec2(fxu(ox - 3), cy + 8 * s), p2: k.vec2(fxu(ox - 1), cy + 15 * s), width: 1.4 * s, color: C(...cloakDk) });
  }
  k.drawEllipse({ pos: k.vec2(ucx, cy + 4 * s), radiusX: 5 * s, radiusY: 10 * s, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 4 * s), radiusX: 4.2 * s, radiusY: 7 * s, color: C(...chitin) });
  k.drawEllipse({ pos: k.vec2(fxu(-3), ucy - 4 * s), radiusX: 1.6 * s, radiusY: 5 * s, color: C(...accent), opacity: 0.26 });
  for (const off of [0, 1.6]) {
    const bx = fxu(2 + off), by = ucy - 7 * s, ex = fxu(8 + off), ey = ucy - 13 * s, dx2 = fxu(6 + off), dy2 = ucy - 5 * s;
    k.drawLine({ p1: k.vec2(bx, by), p2: k.vec2(ex, ey), width: 1.8 * s, color: C(...chitin) });
    k.drawLine({ p1: k.vec2(ex, ey), p2: k.vec2(dx2, dy2), width: 1.8 * s, color: C(...chitin) });
  }
  k.drawEllipse({ pos: k.vec2(ucx, ucy - 13 * s), radiusX: 4 * s, radiusY: 3.4 * s, color: C(...chitin) });
  for (const side of [-1, 1]) {
    const aw = reduce ? 0 : Math.sin(t * 3 + side) * 1.2;
    k.drawLine({ p1: k.vec2(ucx + side * 1.5 * s, ucy - 15 * s), p2: k.vec2(ucx + side * 3 * s + aw * s, ucy - 21 * s), width: 1 * s, color: C(...cloakDk) });
  }
  if (facingCamera) eyes(P, 2.4, ucy - 13 * s, 1.2);
}

function eyesAt(P, ex, half, eyeY, coreR) {
  const { k, C, s, accent } = P;
  for (const sx of [-1, 1]) {
    k.drawCircle({ pos: k.vec2(ex + sx * half * s, eyeY), radius: 3 * s, color: C(...accent), opacity: 0.3 });
    k.drawCircle({ pos: k.vec2(ex + sx * half * s, eyeY), radius: coreR * s, color: C(...accent) });
  }
}
function eyes(P, half, eyeY, coreR) { eyesAt(P, P.ucx, half, eyeY, coreR); }

const MODELS = {
  cloak: cloakModel, knight: knightModel, mage: mageModel, automaton: automatonModel, wisp: wispModel,
  warden: wardenModel, seraph: seraphModel, diver: diverModel, monarch: monarchModel, corvid: corvidModel,
  ronin: roninModel, golem: golemModel, naga: nagaModel, jester: jesterModel, treant: treantModel,
  lich: lichModel, anubis: anubisModel, myconid: myconidModel, angler: anglerModel, scarecrow: scarecrowModel,
  centaur: centaurModel, gorgon: gorgonModel, djinn: djinnModel, pumpkin: pumpkinModel, mantis: mantisModel,
};
export const CHARACTER_MODELS = Object.keys(MODELS);

const DEFAULT_CLOAK = [24, 21, 34];
const _cloakDkCache = new WeakMap();
const _rgbCache = new Map();
function fixedDraw(k) {
  const w = Object.create(k);
  for (const m of ["drawRect", "drawCircle", "drawEllipse", "drawLine", "drawText", "drawSprite", "drawUVQuad", "drawPolygon", "drawTriangle"]) {
    const fn = k[m];
    if (typeof fn === "function") w[m] = (o) => fn.call(k, { ...o, fixed: true });
  }
  return w;
}
export function drawCharacter(k, { x, y, t = 0, moving = false, color = [90, 170, 255], dir = null, skin = null, chainTier = null, cloak: cloakIn = null, scale = 1, model = "cloak", fixed = false, chainSpin = 0, holdChain = true, throwPose = null }) {
  if (fixed) k = fixedDraw(k);
  const C = (r, g, b) => {
    const key = ((r | 0) << 16) | ((g | 0) << 8) | (b | 0);
    let v = _rgbCache.get(key);
    if (v === undefined) { v = k.rgb(r, g, b); _rgbCache.set(key, v); }
    return v;
  };
  const s = scale > 0 ? scale : 1;
  const accent = color;
  const cloak = cloakIn || DEFAULT_CLOAK;
  let cloakDk = _cloakDkCache.get(cloak);
  if (!cloakDk) { cloakDk = [Math.round(cloak[0] * 0.6), Math.round(cloak[1] * 0.6), Math.round(cloak[2] * 0.6)]; _cloakDkCache.set(cloak, cloakDk); }
  const dx = dir ? dir.x : 0;
  const dy = dir ? dir.y : 1;
  const flip = dx < -0.15 ? -1 : 1;
  const facingCamera = !(dy < -0.4 && Math.abs(dy) >= Math.abs(dx));

  const reduce = prefersReducedMotion();
  const idle = reduce ? 0 : Math.sin(t * 2.4) * 1.0;
  const WALK = 8;
  const step = (moving && !reduce) ? Math.sin(t * WALK) : 0;
  const bob = (reduce ? 0 : (moving ? Math.abs(Math.sin(t * WALK)) * 2.0 : idle)) * s;
  const hemSway = (reduce ? 0 : (moving ? Math.sin(t * WALK) * 2 : Math.sin(t * 1.8) * 1.0) * flip) * s;
  const cx = x;
  const cy = y - bob;
  const fx = (o) => cx + o * flip * s;
  const lean = (v, a) => ((moving && !reduce) ? Math.max(-1, Math.min(1, v)) * a * s : 0);
  let tShiftX = 0, tShiftY = 0, tCrouch = 0;
  if (throwPose && !reduce) {
    const along = throwPose.fwd * 7 - throwPose.back * 4;
    tShiftX = (throwPose.dx || 0) * along; tShiftY = (throwPose.dy || 0) * along;
    tCrouch = throwPose.back * 2 - throwPose.fwd * 1.5;
  }
  const ucx = cx + lean(dx, 1.6) + tShiftX * s;
  const ucy = cy + lean(dy, 0.6) + (tShiftY + tCrouch) * s;
  const fxu = (o) => ucx + o * flip * s;

  k.drawEllipse({ pos: k.vec2(x, y + 15 * s), radiusX: 13 * s, radiusY: 4 * s, color: C(0, 0, 0), opacity: 0.3 });

  const P = { k, C, s, accent, cloak, cloakDk, cx, cy, ucx, ucy, fx, fxu, flip, facingCamera, reduce, t, moving, step, hemSway, idle, dx, dy };
  (MODELS[model] || cloakModel)(P);

  if (holdChain) {
    const rx = fxu(15);
    const ry = ucy + 2 * s + (reduce ? 0 : (moving ? Math.abs(step) * 1.5 : Math.sin(t * 2.4)) * s);
    k.drawLine({ p1: k.vec2(fxu(7), ucy - 1 * s), p2: k.vec2(rx, ry), width: 4 * s, color: C(...cloak) });
    drawChainSkin(k, { x: rx, y: ry, r: 7 * s, t: reduce ? 0 : t + chainSpin, skin: skin || getEquippedSkin(), tier: chainTier });
  }
}
