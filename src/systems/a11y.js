const RM_KEY = "tq_reduce_motion";
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
  try { if (typeof localStorage !== "undefined") localStorage.setItem(RM_KEY, v); } catch {}
  _setting = v || "auto"; _lsRef = currentLs();
}
try {
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("storage", (e) => { if (!e || e.key == null || e.key === RM_KEY) _lsRef = null; });
  }
} catch {}

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
