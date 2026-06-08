import { THEME, addMenuBackground } from "../ui/theme.js";

// The title screen is now a pure-HTML overlay (see index.html) so it's fully
// responsive (any resolution, no letterbox/borders) and built from HTML elements
// only. This Phaser scene is just the atmospheric backdrop behind that overlay;
// entering it (on boot, or via an in-game "Back") re-reveals the HTML title.
export default function startScene(k) {
  k.scene("start", () => {
    // Flat THEME.bg fallback under the atmospheric backdrop, so a torn sprite load
    // never paints a dead grey screen behind the HTML overlay.
    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(...THEME.bg)]);
    // The procedural menu backdrop — parity with every other menu scene, so the
    // canvas behind the HTML title overlay reads as part of the same world even
    // if the overlay is transparent during a slow paint.
    try { addMenuBackground(k); } catch { /* sprite not yet loaded (tests) */ }
    try { window.dispatchEvent(new Event("tq:title")); } catch { /* no DOM (tests) */ }
  });
}
