// Accessibility helpers (engine-agnostic, no Kaboom/Phaser/shim dependency).
//
// prefersReducedMotion(): true when the OS/browser "reduce motion" accessibility
// setting is on. Render code should then drop *decorative* animation (ambient
// drift, pulsing, parallax) while keeping gameplay-essential feedback — some
// users get motion sickness / vestibular discomfort from continuous animation.
// Read live (cheap; once per frame) so a mid-session toggle is respected, and
// safe in non-browser contexts (returns false).

// In-game override (Settings) layered over the OS setting so players can force it
// either way (the OS toggle is buried / not everyone knows it):
//   "on" → always reduce · "off" → never reduce · "auto"/unset → follow the OS.
const RM_KEY = "tq_reduce_motion";
export function reduceMotionSetting() {
  try { return (typeof localStorage !== "undefined" && localStorage.getItem(RM_KEY)) || "auto"; }
  catch { return "auto"; }
}
export function setReduceMotion(v) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(RM_KEY, v); } catch { /* ignore */ }
}

export function prefersReducedMotion() {
  const s = reduceMotionSetting();
  if (s === "on") return true;
  if (s === "off") return false;
  try {
    return typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
