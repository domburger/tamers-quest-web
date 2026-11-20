// Global shake state (one camera): call clearShake() on scene entry.

let trauma = 0;
const MAX = 14;
const DECAY = 1.8;

let enabled = true;
try { enabled = localStorage.getItem("tq_shake") !== "0"; } catch {}
export function shakeEnabled() { return enabled; }
export function setShakeEnabled(on) {
  enabled = !!on;
  try { localStorage.setItem("tq_shake", enabled ? "1" : "0"); } catch {}
  if (!enabled) trauma = 0;
  return enabled;
}
export function toggleShake() { return setShakeEnabled(!enabled); }

export function addShake(amount = 0.4) { if (enabled) trauma = Math.min(1, trauma + Math.max(0, amount)); }

export function updateShake(dt) { if (trauma > 0) trauma = Math.max(0, trauma - DECAY * dt); }

export function shakeOffset() {
  if (trauma <= 0) return { x: 0, y: 0 };
  const m = trauma * trauma * MAX;
  return { x: (Math.random() * 2 - 1) * m, y: (Math.random() * 2 - 1) * m };
}

export function shakeTrauma() { return trauma; }
export function clearShake() { trauma = 0; }
export const SHAKE_MAX = MAX;
