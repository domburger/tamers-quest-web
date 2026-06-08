// Screen-shake (PV-A5 game-feel). Trauma-based model: impactful events add "trauma"
// (0..1, capped); it decays a bit each frame; the per-frame camera offset scales with
// trauma SQUARED so small hits barely nudge the view while big ones really kick. Scenes
// add shakeOffset() to their k.camPos() each frame and call addShake() on impacts.
//
// Pure + engine-agnostic (no shim import) → unit-testable and shared SP/MP, like fx.js.
// Global state (one camera), so call clearShake() on scene entry. Respect reduce-motion
// at the call site (scenes skip addShake under prefersReducedMotion()).

let trauma = 0;
const MAX = 14;    // peak camera offset in world px (at full trauma)
const DECAY = 1.8; // trauma units shed per second

// Add an impact. `amount` ~0.2 (small tick) … 0.6 (big hit) … 1 (death). Capped at 1.
export function addShake(amount = 0.4) { trauma = Math.min(1, trauma + Math.max(0, amount)); }

// Advance the decay by dt seconds (call once per frame).
export function updateShake(dt) { if (trauma > 0) trauma = Math.max(0, trauma - DECAY * dt); }

// Current camera offset {x, y}, magnitude ≤ trauma²·MAX, random jitter each call.
// Zero (and allocation-cheap) when at rest, so it's safe to add unconditionally.
export function shakeOffset() {
  if (trauma <= 0) return { x: 0, y: 0 };
  const m = trauma * trauma * MAX;
  return { x: (Math.random() * 2 - 1) * m, y: (Math.random() * 2 - 1) * m };
}

export function shakeTrauma() { return trauma; }
export function clearShake() { trauma = 0; }
export const SHAKE_MAX = MAX; // exposed for tests/tuning
