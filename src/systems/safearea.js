// env() insets need viewport-fit=cover in index.html.

export function safeInsetsDesign(k) {
  const css = readSafeAreaInsets();
  try {
    const cv = typeof document !== "undefined" ? document.querySelector("canvas") : null;
    const hCss = cv ? cv.getBoundingClientRect().height : 0;
    const designH = k && typeof k.height === "function" ? k.height() : 0;
    const scale = hCss > 0 && designH > 0 ? hCss / designH : 1;
    return { top: css.top / scale, right: css.right / scale, bottom: css.bottom / scale, left: css.left / scale };
  } catch {
    return css;
  }
}

let _gcsRef = null, _cssInsets = null;
try {
  if (typeof window !== "undefined" && window.addEventListener) {
    const drop = () => { _cssInsets = null; };
    window.addEventListener("resize", drop);
    window.addEventListener("orientationchange", drop);
  }
} catch {}
export function readSafeAreaInsets() {
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };
  try {
    if (typeof document === "undefined" || !document.body || typeof getComputedStyle !== "function") return zero;
    if (_cssInsets && getComputedStyle === _gcsRef) return _cssInsets;
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
      "padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);" +
      "padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);";
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };
    const out = { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
    probe.remove();
    _gcsRef = getComputedStyle; _cssInsets = out;
    return out;
  } catch {
    return zero;
  }
}
