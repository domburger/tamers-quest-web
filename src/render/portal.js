import { prefersReducedMotion } from "../systems/a11y.js";

const RISE_S = 1.2;
const BASE_W = 30;
const FULL_H = 56;
const TEAL = [70, 230, 198];
const CORE = [200, 240, 255];

const lerp = (a, b, u) => a + (b - a) * u;

const _colCache = new Map();
export function drawPortal(k, { x, y, t, age = 999 }) {
  const col = (c) => {
    const key = ((c[0] | 0) << 16) | ((c[1] | 0) << 8) | (c[2] | 0);
    let v = _colCache.get(key);
    if (v === undefined) { v = k.rgb(c[0], c[1], c[2]); _colCache.set(key, v); }
    return v;
  };
  const r = Math.max(0, Math.min(1, age / RISE_S));
  const rise = 1 - (1 - r) * (1 - r);
  const reduce = prefersReducedMotion();
  const pulse = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 4);
  const opening = r < 1;

  const H = FULL_H * rise;
  const W = BASE_W * (0.35 + 0.65 * rise);
  const cy = y - H * 0.52;

  k.drawEllipse({ pos: k.vec2(x, y), radiusX: W * 1.25, radiusY: 7 + 3 * pulse, color: col(TEAL), opacity: 0.18 + 0.12 * pulse });
  if (opening) {
    const crackW = lerp(2, W * 1.1, Math.min(1, r * 1.4));
    k.drawEllipse({ pos: k.vec2(x, y), radiusX: crackW, radiusY: 4, color: col(CORE), opacity: 0.5 * (1 - r) + 0.2 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + t * 2;
      const dr = (1 - r) * 14;
      k.drawCircle({ pos: k.vec2(x + Math.cos(a) * (W * 0.6 + dr), y - Math.abs(Math.sin(a)) * dr), radius: 1.8 * (1 - r) + 0.5, color: col(TEAL), opacity: 0.35 * (1 - r) });
    }
  }

  if (rise < 0.04) return;

  k.drawEllipse({ pos: k.vec2(x, cy - H * 0.2), radiusX: W * 0.5, radiusY: H * 0.9, color: col(TEAL), opacity: 0.10 * rise });

  k.drawEllipse({ pos: k.vec2(x, cy), radiusX: W * 1.15, radiusY: H * 0.6, color: col(TEAL), opacity: 0.16 });
  k.drawEllipse({ pos: k.vec2(x, cy), radiusX: W, radiusY: H * 0.5, color: col([27, 142, 123]), opacity: 0.55 });
  k.drawEllipse({ pos: k.vec2(x, cy), radiusX: W * 0.62, radiusY: H * 0.34, color: col(TEAL), opacity: 0.6 });
  k.drawEllipse({ pos: k.vec2(x, cy), radiusX: W * 0.28 * pulse, radiusY: H * 0.18 * pulse, color: col(CORE), opacity: 0.85 });

  k.drawEllipse({ pos: k.vec2(x, cy), radiusX: W, radiusY: H * 0.5, fill: false, outline: { width: 2, color: col(CORE) }, opacity: 0.35 + 0.35 * pulse });

  const motes = 6;
  for (let i = 0; i < motes; i++) {
    const a = (reduce ? 0 : t * 2.2) + (i / motes) * Math.PI * 2;
    const mx = x + Math.cos(a) * W * 0.95;
    const my = cy + Math.sin(a) * H * 0.46;
    const near = (Math.sin(a) + 1) / 2;
    k.drawCircle({ pos: k.vec2(mx, my), radius: 1 + 1.6 * near, color: col(CORE), opacity: (0.3 + 0.5 * near) * rise });
  }
}

export function drawExtractFlash(k, { x, y, p }) {
  const q = Math.max(0, Math.min(1, p));
  const e = 1 - (1 - q) * (1 - q);
  const W = k.width(), H = k.height();
  k.drawCircle({ pos: k.vec2(x, y), radius: 20 + e * Math.max(W, H) * 0.85, fill: false,
    outline: { width: Math.max(1, 9 * (1 - q)), color: k.rgb(120, 255, 235) }, opacity: 0.8 * (1 - q), fixed: true });
  k.drawCircle({ pos: k.vec2(x, y), radius: 10 + e * 130, color: k.rgb(225, 255, 250), opacity: 0.45 * (1 - q) + 0.1, fixed: true });
  const flash = Math.sin(Math.min(1, q * 1.25) * Math.PI);
  k.drawRect({ pos: k.vec2(0, 0), width: W, height: H, color: k.rgb(230, 255, 250), opacity: 0.55 * flash, fixed: true });
}
