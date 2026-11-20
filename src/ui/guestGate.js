import { THEME, FONT_BOLD, FONT_BODY, addPanel, addLabel, addButton } from "./theme.js";
import { iconSpriteKey } from "./icons.js";

export function addGuestGate(k, { cx, top = 150, icon = "person", title = "Log in to continue", text = "", lines = 2, onLogin } = {}) {
  const colW = Math.min(440, k.width() - 48);
  const narrow = k.width() < 560;
  const bodyLines = narrow ? lines + 2 : lines;
  const discY = top + 58, titleY = top + 118, bodyY = top + 140;
  const btnY = bodyY + bodyLines * 19 + 34;
  const panelH = btnY + 44 - top;
  addPanel(k, { x: cx, y: top + panelH / 2, w: colW, h: panelH, radius: 20 });
  k.add([k.circle(32), k.pos(cx, discY), k.anchor("center"), k.color(...THEME.primary), k.opacity(0.14)]);
  k.add([k.circle(32, { fill: false }), k.pos(cx, discY), k.anchor("center"), k.color(...THEME.primary), k.opacity(0.55), k.outline(1, k.rgb(...THEME.primary))]);
  const key = iconSpriteKey(k, icon, { size: 34, color: THEME.primary });
  if (key) k.add([k.sprite(key), k.pos(cx, discY), k.anchor("center"), k.scale(0.5)]);
  addLabel(k, { x: cx, y: titleY, text: title, size: 22, color: THEME.text, font: FONT_BOLD });
  addLabel(k, { x: cx, y: bodyY, anchor: "top", text, size: 14, color: THEME.textBody, font: FONT_BODY, width: colW - 48, align: "center" });
  addButton(k, { x: cx, y: btnY, w: 200, h: 44, text: "Log in", size: 17, icon: "person",
    fill: THEME.primary, textColor: THEME.textInv, onClick: onLogin || (() => k.go("start")) });
}
