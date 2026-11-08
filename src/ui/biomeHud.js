import { biomeNameAt } from "../engine/mapgen.js";
import { THEME, FONT_BOLD, drawGlass } from "./theme.js"; // pull chip colours from the design tokens (no raw RGB drift)
import { drawIcon } from "./icons.js"; // UI v4: region icon

// PT1-T18: a compact "current biome" chip so players can read which region they're in
// at a glance (useful for orientation across the large map). Drawn in fixed/HUD space;
// shared by SP (game.js) and MP (onlineGame.js) so both communicate it identically.
//
// The old "speed cue" (brisk/slow/steady) was removed 2026-06-09 along with per-biome
// movement modifiers — biomes are purely visual regions now, so the chip just names
// the biome. Plain ASCII only (no glyphs — UI guardrail).
export function drawBiomeChip(k, { x, y, map, wx, wy }) {
  const name = biomeNameAt(map, wx, wy);
  if (!name) return;

  const label = name.replace(/\b\w/g, (c) => c.toUpperCase()); // TQ-157: Title case, not stylistic all-caps
  const tw = typeof k.measureText === "function" ? k.measureText(label, 12, FONT_BOLD) : label.length * 7.0;
  const w = 34 + tw + 12, h = 24;
  const px = x - w / 2; // x is the chip's horizontal center
  // UI v4 glass chip with the region icon in the accent; the label is bold and vertically centred on the icon
  // (TQ-558/559: left-anchored text draws from its TOP edge, so offset by half the font size).
  drawGlass(k, { rect: [px, y, w, h], radius: 12, tint: 0.62, fill: 0.06, line: 0.14, fixed: true });
  drawIcon(k, "region", { x: px + 17, y: y + h / 2, size: 13, color: THEME.teal, fixed: true });
  k.drawText({ text: label, pos: k.vec2(px + 30, y + h / 2 - 6), size: 12, font: FONT_BOLD, anchor: "left", color: k.rgb(...THEME.text), fixed: true });
}
