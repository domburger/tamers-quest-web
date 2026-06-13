import { biomeNameAt } from "../engine/mapgen.js";
import { THEME } from "./theme.js"; // pull chip colours from the design tokens (no raw RGB drift)

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
  const w = 28 + label.length * 7.0, h = 22;
  const px = x - w / 2; // x is the chip's horizontal center
  // Themed chip: dark panel fill + hairline + a teal accent dot (the design language's
  // accent), so the HUD chip reads as the same family as the menus' panels/buttons.
  k.drawRect({ pos: k.vec2(px, y), width: w, height: h, radius: 11, color: k.rgb(...THEME.surface), opacity: 0.72, outline: { width: 1, color: k.rgb(...THEME.line) }, fixed: true });
  k.drawCircle({ pos: k.vec2(px + 14, y + h / 2), radius: 4, color: k.rgb(...THEME.teal), fixed: true });
  k.drawText({ text: label, pos: k.vec2(px + 26, y + h / 2 + 0.5), size: 12, font: "gameFont", anchor: "left", color: k.rgb(...THEME.text), fixed: true });
}
