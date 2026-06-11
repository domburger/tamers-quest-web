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

// Cache the MediaQueryList: window.matchMedia() re-parses the query string and
// allocates a fresh object on every call, but this runs many times per frame
// across the render code. The MQL's .matches stays live (reflects the current OS
// state), so reactivity is preserved; we only avoid re-creating it. Re-key on the
// matchMedia function identity so swapping the implementation (tests, polyfills)
// transparently rebuilds the cache.
let _mqlFn = null, _mql = null;
export function prefersReducedMotion() {
  const s = reduceMotionSetting();
  if (s === "on") return true;
  if (s === "off") return false;
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    if (window.matchMedia !== _mqlFn) {
      _mqlFn = window.matchMedia;
      _mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    }
    return !!_mql.matches;
  } catch {
    return false;
  }
}
