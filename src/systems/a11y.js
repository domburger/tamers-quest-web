// Accessibility helpers (engine-agnostic, no Kaboom/Phaser/shim dependency).
//
// prefersReducedMotion(): true when the OS/browser "reduce motion" accessibility
// setting is on. Render code should then drop *decorative* animation (ambient
// drift, pulsing, parallax) while keeping gameplay-essential feedback — some
// users get motion sickness / vestibular discomfort from continuous animation.
// Read live (cheap; once per frame) so a mid-session toggle is respected, and
// safe in non-browser contexts (returns false).

export function prefersReducedMotion() {
  try {
    return typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
