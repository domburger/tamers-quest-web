import { THEME } from "../ui/theme.js";

// The title screen is now a pure-HTML overlay (see index.html) so it's fully
// responsive (any resolution, no letterbox/borders) and built from HTML elements
// only. This Phaser scene is just the dark backdrop behind that overlay; entering
// it (on boot, or via an in-game "Back") re-reveals the HTML title.
export default function startScene(k) {
  k.scene("start", () => {
    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(...THEME.bg)]);
    try { window.dispatchEvent(new Event("tq:title")); } catch { /* no DOM (tests) */ }
  });
}
