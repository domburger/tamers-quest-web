// Unified particle/FX system (PV-T12). One reusable, pooled, budget-capped emitter
// so hits / dust / sparks / pickups all share a single path instead of ad-hoc
// per-scene draws. Pure shim primitives (drawCircle) — no engine deps, world-space
// coordinates (the camera transform applies). A scene drives it by calling
// `updateFx(dt)` in its onUpdate and `drawFx(k)` in its onDraw (after the world,
// before the HUD). `clearFx()` on scene leave.
//
// Deterministic-safe: uses Math.random only for cosmetic spread (never gameplay).

import { prefersReducedMotion } from "../systems/a11y.js";
import { hasTouch } from "../systems/inputMode.js"; // single-source touch-capability check (shared with the on-screen controls)

// Particle budget — excess emits are dropped, never unbounded. Settable so a "mobile
// performance mode" (MOB-T3) can lower the ceiling on touch / low-end devices, cutting
// overdraw. Defaults to a conservative value on touch-capable devices (detected once at
// load); desktop keeps the full budget. setFxBudget() also lets tests/perf-tuning override.
const FX_MAX_DESKTOP = 220, FX_MAX_TOUCH = 120;
let budget = FX_MAX_DESKTOP;
try {
  if (hasTouch()) budget = FX_MAX_TOUCH; // touch hardware (any) → lighter particle ceiling
} catch { /* non-browser → keep desktop default */ }
export function setFxBudget(n) { budget = Math.max(0, Math.floor(Number(n) || 0)); }
export function fxBudget() { return budget; }
const pool = [];
// Count of screen-space (fixed:true) particles live in the pool. Screen-space particles only spawn from
// the combat panel; the overworld/hub spawn world-space (fixed:false) bursts. Tracking the count lets
// drawFxScreen() early-out instead of scanning the whole pool every frame for nothing (the common case).
let fixedCount = 0;

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
    if (pool.length >= budget) break;
    const a = dir + (Math.random() - 0.5) * spread;
    const sp = speed * (0.5 + Math.random());
    pool.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, maxLife: life, size, color, gravity, drag, fixed });
    if (fixed) fixedCount++;
  }
}

// Spawn a floating text label (PT2-T07): a short caption that rises and fades —
// loot pickups ("Chest!"), level-ups ("+LVL"), etc. Shares the particle pool/budget
// so it's reaped the same way. Unlike decorative bursts, the label is informational,
// so it is NOT suppressed under reduce-motion — only its rise is frozen.
//   x,y    world position (or screen if fixed)
//   text   the caption string
//   color  [r,g,b]   life seconds   size font px   rise px/s upward   fixed screen-space
export function emitText({ x, y, text, color = [255, 255, 255], life = 0.95, size = 15, rise = 30, fixed = false } = {}) {
  if (pool.length >= budget) return;
  const vy = prefersReducedMotion() ? 0 : -rise;
  pool.push({ x, y, vx: 0, vy, life, maxLife: life, size, color, gravity: 0, drag: 0, fixed, text });
  if (fixed) fixedCount++;
}

// Advance all live particles; reap the dead. Call once per frame with dt seconds.
export function updateFx(dt) {
  for (let i = pool.length - 1; i >= 0; i--) {
    const p = pool[i];
    p.life -= dt;
    if (p.life <= 0) { if (p.fixed) fixedCount--; pool[i] = pool[pool.length - 1]; pool.pop(); continue; } // swap-remove (no O(n) splice)
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
  if (p.text != null) {
    // Floating label: constant size, fades out; a faint dark backer keeps it legible
    // over busy ground. drawText centres on pos.
    k.drawText({ text: p.text, pos: k.vec2(p.x, p.y + 1), size: p.size, anchor: "center", color: k.rgb(0, 0, 0), opacity: 0.45 * a, fixed: !!p.fixed });
    k.drawText({ text: p.text, pos: k.vec2(p.x, p.y), size: p.size, anchor: "center", color: k.rgb(p.color[0], p.color[1], p.color[2]), opacity: a, fixed: !!p.fixed });
    return;
  }
  const col = k.rgb(p.color[0], p.color[1], p.color[2]);
  const r = Math.max(0.5, p.size * a);
  // Soft bloom halo so each particle reads as *light* (bioluminescent) rather than a
  // flat dot, then the brighter core on top. One extra cheap circle per particle.
  k.drawCircle({ pos: k.vec2(p.x, p.y), radius: r * 2.4, color: col, opacity: 0.16 * a * a, fixed: !!p.fixed });
  k.drawCircle({ pos: k.vec2(p.x, p.y), radius: r, color: col, opacity: 0.78 * a, fixed: !!p.fixed });
}
export function drawFx(k) { for (const p of pool) if (!p.fixed) drawOne(k, p); }
export function drawFxScreen(k) { if (fixedCount === 0) return; for (const p of pool) if (p.fixed) drawOne(k, p); }

export function clearFx() { pool.length = 0; fixedCount = 0; }
export function fxCount() { return pool.length; } // for tests / perf checks
