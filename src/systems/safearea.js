// Safe-area inset helper (engine-agnostic, no Kaboom/Phaser/shim dependency).
//
// readSafeAreaInsets(): the CSS env(safe-area-inset-*) values in px — the notch /
// rounded-corner / home-bar margins a device reserves. These are non-zero only
// when the page opts in with `viewport-fit=cover` (index.html does). Touch HUD
// code keeps its controls inside these so they don't sit under the notch or the
// home indicator.
//
// env() only resolves through a real style computation, so we read it off a hidden
// probe element's padding. Returns zeros when unavailable (non-browser context, a
// display with no insets, or any failure) so callers can add the values
// unconditionally without a guard.

// Safe-area insets converted to the renderer's DESIGN units (what scenes lay out in),
// given the shim `k`. The canvas is uniformly FIT-scaled, so 1 design unit = (canvas CSS
// height / k.height()) CSS px; we divide the CSS-px insets by that to get design units.
// Returns zeros off-browser / when the canvas isn't measurable, so callers add it
// unconditionally. Shared by the in-round HUD (MB-4) and menu scenes (MOB-T2) — one
// source instead of each scene re-deriving the canvas scale.
export function safeInsetsDesign(k) {
  const css = readSafeAreaInsets();
  try {
    const cv = typeof document !== "undefined" ? document.querySelector("canvas") : null;
    const hCss = cv ? cv.getBoundingClientRect().height : 0;
    const designH = k && typeof k.height === "function" ? k.height() : 0;
    const scale = hCss > 0 && designH > 0 ? hCss / designH : 1; // CSS px per design unit
    return { top: css.top / scale, right: css.right / scale, bottom: css.bottom / scale, left: css.left / scale };
  } catch {
    return css;
  }
}

export function readSafeAreaInsets() {
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };
  try {
    if (typeof document === "undefined" || !document.body || typeof getComputedStyle !== "function") return zero;
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
    return out;
  } catch {
    return zero;
  }
}
