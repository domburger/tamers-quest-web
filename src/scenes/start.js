import { THEME, addMenuBackground } from "../ui/theme.js";

export default function startScene(k) {
  k.scene("start", () => {
    k.add([k.rect(k.width(), k.height()), k.pos(0, 0), k.color(...THEME.bg)]);
    try { addMenuBackground(k); } catch {}
    try { window.dispatchEvent(new Event("tq:title")); } catch {}
  });
}
