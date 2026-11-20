import { biomeNameAt } from "../engine/mapgen.js";
import { THEME, FONT_BOLD, drawGlass } from "./theme.js";
import { drawIcon } from "./icons.js";

export function drawBiomeChip(k, { x, y, map, wx, wy }) {
  const name = biomeNameAt(map, wx, wy);
  if (!name) return;

  const label = name.replace(/\b\w/g, (c) => c.toUpperCase());
  const tw = typeof k.measureText === "function" ? k.measureText(label, 12, FONT_BOLD) : label.length * 7.0;
  const w = 34 + tw + 12, h = 24;
  const px = x - w / 2;
  drawGlass(k, { rect: [px, y, w, h], radius: 12, tint: 0.62, fill: 0.06, line: 0.14, fixed: true });
  drawIcon(k, "region", { x: px + 17, y: y + h / 2, size: 13, color: THEME.teal, fixed: true });
  k.drawText({ text: label, pos: k.vec2(px + 30, y + h / 2 - 6), size: 12, font: FONT_BOLD, anchor: "left", color: k.rgb(...THEME.text), fixed: true });
}
