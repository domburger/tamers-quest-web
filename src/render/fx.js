import { prefersReducedMotion } from "../systems/a11y.js";
import { hasTouch } from "../systems/inputMode.js";

const FX_MAX_DESKTOP = 220, FX_MAX_TOUCH = 120;
let budget = FX_MAX_DESKTOP;
try {
  if (hasTouch()) budget = FX_MAX_TOUCH;
} catch {}
export function setFxBudget(n) { budget = Math.max(0, Math.floor(Number(n) || 0)); }
export function fxBudget() { return budget; }
const pool = [];
let fixedCount = 0;

export function emit({ x, y, n = 6, color = [255, 255, 255], speed = 40, life = 0.5,
  size = 3, spread = Math.PI * 2, dir = 0, gravity = 0, drag = 0, fixed = false } = {}) {
  if (prefersReducedMotion()) return;
  for (let i = 0; i < n; i++) {
    if (pool.length >= budget) break;
    const a = dir + (Math.random() - 0.5) * spread;
    const sp = speed * (0.5 + Math.random());
    pool.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, maxLife: life, size, color, gravity, drag, fixed });
    if (fixed) fixedCount++;
  }
}

export function emitText({ x, y, text, color = [255, 255, 255], life = 0.95, size = 15, rise = 30, fixed = false } = {}) {
  if (pool.length >= budget) return;
  const vy = prefersReducedMotion() ? 0 : -rise;
  pool.push({ x, y, vx: 0, vy, life, maxLife: life, size, color, gravity: 0, drag: 0, fixed, text });
  if (fixed) fixedCount++;
}

export function updateFx(dt) {
  for (let i = pool.length - 1; i >= 0; i--) {
    const p = pool[i];
    p.life -= dt;
    if (p.life <= 0) { if (p.fixed) fixedCount--; pool[i] = pool[pool.length - 1]; pool.pop(); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.gravity) p.vy += p.gravity * dt;
    if (p.drag) { const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy *= d; }
  }
}

function drawOne(k, p) {
  const a = p.life / p.maxLife;
  const col = p._col || (p._col = k.rgb(p.color[0], p.color[1], p.color[2]));
  if (p.text != null) {
    k.drawText({ text: p.text, pos: k.vec2(p.x, p.y + 1), size: p.size, anchor: "center", color: k.rgb(0, 0, 0), opacity: 0.45 * a, fixed: !!p.fixed });
    k.drawText({ text: p.text, pos: k.vec2(p.x, p.y), size: p.size, anchor: "center", color: col, opacity: a, fixed: !!p.fixed });
    return;
  }
  const r = Math.max(0.5, p.size * a);
  k.drawCircle({ pos: k.vec2(p.x, p.y), radius: r * 2.4, color: col, opacity: 0.16 * a * a, fixed: !!p.fixed });
  k.drawCircle({ pos: k.vec2(p.x, p.y), radius: r, color: col, opacity: 0.78 * a, fixed: !!p.fixed });
}
export function drawFx(k) { for (const p of pool) if (!p.fixed) drawOne(k, p); }
export function drawFxScreen(k) { if (fixedCount === 0) return; for (const p of pool) if (p.fixed) drawOne(k, p); }

export function clearFx() { pool.length = 0; fixedCount = 0; }
export function fxCount() { return pool.length; }
