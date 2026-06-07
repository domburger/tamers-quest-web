import { THEME, addLabel } from "../ui/theme.js";

export default function settingsScene(k) {
  k.scene("settings", ({ characterId }) => {
    const cx = k.width() / 2;
    k.add([k.sprite("menu_background"), k.pos(k.width() / 2, k.height() / 2), k.anchor("center")]);

    addLabel(k, { x: cx, y: 50, text: "SETTINGS", size: 36, color: THEME.text });

    addLabel(k, { x: cx, y: k.height() / 2, width: 500,
      text: "No settings to configure yet.",
      size: 16, color: THEME.textMut });

    // Back button
    const backBtn = k.add([
      k.text("< Back", { size: 20, font: "gameFont" }),
      k.pos(30, 30),
      k.anchor("topleft"),
      k.color(...THEME.textMut),
      k.area(),
    ]);
    backBtn.onClick(() => {
      k.go("lobby", { characterId });
    });
  });
}
