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
