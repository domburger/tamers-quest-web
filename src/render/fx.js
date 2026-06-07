// Unified particle/FX system (PV-T12). One reusable, pooled, budget-capped emitter
// so hits / dust / sparks / pickups all share a single path instead of ad-hoc
// per-scene draws. Pure shim primitives (drawCircle) — no engine deps, world-space
// coordinates (the camera transform applies). A scene drives it by calling
// `updateFx(dt)` in its onUpdate and `drawFx(k)` in its onDraw (after the world,
// before the HUD). `clearFx()` on scene leave.
//
// Deterministic-safe: uses Math.random only for cosmetic spread (never gameplay).

import { prefersReducedMotion } from "../systems/a11y.js";

const MAX = 220; // hard particle budget — excess emits are dropped, never unbounded
const pool = [];

// Spawn a burst. All fields optional with sensible defaults.
//   x,y      world position
//   n        particle count
//   color    [r,g,b]
//   speed    base px/s (each particle gets 0.5x–1.5x)
//   life     seconds
//   size     px radius at birth (shrinks to 0 over life)
//   spread   angular cone width (radians) around `dir`
//   dir      cone center angle (radians; -PI/2 = up)
//   gravity  px/s² added to vy (positive = falls)
//   drag     per-second velocity damping (0 = none)
//   fixed    true = screen-space (drawn by drawFxScreen over the HUD/overlays);
//            false = world-space (drawn by drawFx over the floor, under the HUD)
export function emit({ x, y, n = 6, color = [255, 255, 255], speed = 40, life = 0.5,
  size = 3, spread = Math.PI * 2, dir = 0, gravity = 0, drag = 0, fixed = false } = {}) {
  // a11y: under reduce-motion, suppress decorative particle bursts (footstep dust,
  // reward/level-up bursts, combat sparks). The underlying events keep their other
  // feedback (SFX, HP bars, damage numbers, the catch result) — only the flying
  // particles are dropped. (No-op in non-browser test contexts → fx tests unaffected.)
  if (prefersReducedMotion()) return;
  for (let i = 0; i < n; i++) {
    if (pool.length >= MAX) break;
    const a = dir + (Math.random() - 0.5) * spread;
    const sp = speed * (0.5 + Math.random());
    pool.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, maxLife: life, size, color, gravity, drag, fixed });
  }
}

// Advance all live particles; reap the dead. Call once per frame with dt seconds.
export function updateFx(dt) {
  for (let i = pool.length - 1; i >= 0; i--) {
    const p = pool[i];
    p.life -= dt;
    if (p.life <= 0) { pool[i] = pool[pool.length - 1]; pool.pop(); continue; } // swap-remove (no O(n) splice)
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.gravity) p.vy += p.gravity * dt;
    if (p.drag) { const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy *= d; }
  }
}

// Draw live particles, fading + shrinking over each life. World-space particles via
// drawFx (over the floor, under the HUD); screen-space (emit{fixed:true}) via
// drawFxScreen, called AFTER the HUD/overlays so combat-panel sparkles land on top.
function drawOne(k, p) {
  const a = p.life / p.maxLife; // 1 → 0
  k.drawCircle({ pos: k.vec2(p.x, p.y), radius: Math.max(0.5, p.size * a), color: k.rgb(p.color[0], p.color[1], p.color[2]), opacity: 0.7 * a, fixed: !!p.fixed });
}
export function drawFx(k) { for (const p of pool) if (!p.fixed) drawOne(k, p); }
export function drawFxScreen(k) { for (const p of pool) if (p.fixed) drawOne(k, p); }

export function clearFx() { pool.length = 0; }
export function fxCount() { return pool.length; } // for tests / perf checks
