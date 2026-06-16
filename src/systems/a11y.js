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
// Cache the setting: reduceMotionSetting() runs MANY times per frame (every render module gates its
// decorative motion on it), and localStorage.getItem is a synchronous storage read — cheap once, wasteful
// 10-30x/frame. Re-key on the localStorage object IDENTITY (same trick the matchMedia MQL below uses), so
// swapping the impl (tests/polyfills) transparently rebuilds the cache while production's stable storage
// object reads exactly once. setReduceMotion keeps it coherent; a cross-tab write fires `storage` (below).
let _lsRef = null, _setting = "auto";
function currentLs() { try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; } }
export function reduceMotionSetting() {
  const ls = currentLs();
  if (ls !== _lsRef) {
    _lsRef = ls;
    try { _setting = (ls && ls.getItem(RM_KEY)) || "auto"; } catch { _setting = "auto"; }
  }
  return _setting;
}
export function setReduceMotion(v) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(RM_KEY, v); } catch { /* ignore */ }
  _setting = v || "auto"; _lsRef = currentLs(); // keep the in-memory cache coherent without a re-read
}
// Cross-tab: another tab toggling the setting writes the SAME storage object (identity unchanged), so
// reduceMotionSetting wouldn't notice — invalidate the cache on the storage event to preserve the prior
// "read live" reactivity. Guarded so it's inert in non-browser contexts (tests/SSR add no listener).
try {
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("storage", (e) => { if (!e || e.key == null || e.key === RM_KEY) _lsRef = null; });
  }
} catch { /* ignore */ }

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
