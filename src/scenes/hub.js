// The walkable LOBBY HUB (user 2026-06-10): instead of a menu, the player walks their vector
// character around a small camp and approaches stations — a CAVE ENTRANCE (start a run), a HEALER,
// a MERCHANT (spirit shop) and the VAULT (team/inventory). Rendered in the SAME flat-vector style
// as the in-run overworld: the player is `drawCharacter` (their equipped cosmetic) and the camp is
// drawn with immediate-mode primitives. Purely client-side until the player enters the cave (only
// then does it open the WS + queue a run — see step 3). Stations route to the EXISTING scenes
// (onlineShop / roster / net.heal / the run handshake), so this only changes HOW you navigate to
// them, not what they do.

import { drawCharacter } from "../render/character.js";
import { getEquippedCharacterSkin } from "../render/characterCosmetics.js";
import { getEquippedSkin } from "../render/chainCosmetics.js";
import { getCharacter } from "../storage.js";
import { THEME } from "../ui/theme.js";

// Camp world bounds (px). Roomy enough that walking between stations feels like a place, small
// enough that it's a few seconds to cross. The camera follows the player within these bounds.
const W = 1600, H = 1120;
const SPEED = 200;        // px/s — matches GAME.BASE_SPEED so it feels like the overworld
const PR = 13;            // player collision radius (≈ rendered half-width); keeps the body in-bounds

export default function hubScene(k) {
  k.scene("hub", ({ characterId } = {}) => {
    const character = getCharacter(characterId);
    if (!character) { k.go("characterSelect"); return; }

    // Player state — a LOCAL walkable position (no server needed to idle in camp).
    const me = { x: W / 2, y: H * 0.72 }; // spawn lower-centre, so the cave (top) is "ahead"
    let dir = { x: 0, y: -1 };            // facing up toward the cave on entry
    let moving = false;
    const cos = getEquippedCharacterSkin(); // the player's accent / cloak / body model

    // ── input → local movement (keyboard + arrows; touch joystick + gamepad added in polish) ──
    k.onUpdate(() => {
      let dx = 0, dy = 0;
      if (k.isKeyDown("w") || k.isKeyDown("up")) dy -= 1;
      if (k.isKeyDown("s") || k.isKeyDown("down")) dy += 1;
      if (k.isKeyDown("a") || k.isKeyDown("left")) dx -= 1;
      if (k.isKeyDown("d") || k.isKeyDown("right")) dx += 1;
      moving = !!(dx || dy);
      if (moving) {
        dir = { x: dx, y: dy };
        if (dx && dy) { dx *= 0.707; dy *= 0.707; } // normalize diagonal
        const step = SPEED * k.dt();
        me.x = Math.max(PR, Math.min(W - PR, me.x + dx * step));
        me.y = Math.max(PR, Math.min(H - PR, me.y + dy * step));
      }
      // Camera follows the player, clamped so it never shows past the camp edges.
      const halfW = k.width() / 2, halfH = k.height() / 2;
      const cx = Math.max(halfW, Math.min(W - halfW, me.x));
      const cy = Math.max(halfH, Math.min(H - halfH, me.y));
      k.camPos(W <= k.width() ? W / 2 : cx, H <= k.height() ? H / 2 : cy);
    });

    // ── render the camp + player (immediate mode, same as the overworld) ──
    k.onDraw(() => {
      const t = k.time();
      // Ground: a warm cave-camp floor with a darker framed border, so it reads as a PLACE, not a
      // flat rect. Subtle scattered pebbles add texture without sprites.
      k.drawRect({ pos: k.vec2(0, 0), width: W, height: H, color: k.rgb(...THEME.bg) });
      k.drawRect({ pos: k.vec2(0, 0), width: W, height: H, color: k.rgb(...THEME.surface), opacity: 0.5 });
      // Inset "trodden ground" oval — a lighter packed-earth clearing the camp sits on.
      k.drawEllipse({ pos: k.vec2(W / 2, H / 2), radiusX: W * 0.46, radiusY: H * 0.42, color: k.rgb(...THEME.surfaceAlt), opacity: 0.55 });
      // A framing border so the edges read as walls/rock (fill:false → stroke only).
      k.drawRect({ pos: k.vec2(0, 0), width: W, height: H, fill: false, outline: { width: 6, color: k.rgb(...THEME.line) } });
      // Scattered pebbles (deterministic from a fixed seed so they don't shimmer).
      for (let i = 0; i < 60; i++) {
        const px = (i * 9301 + 49297) % W, py = (i * 233280 + 12345) % H;
        k.drawCircle({ pos: k.vec2(px, py), radius: 2.5, color: k.rgb(...THEME.line), opacity: 0.18 });
      }

      // The player — their exact equipped vector character (the style they love).
      drawCharacter(k, { x: me.x, y: me.y, t, moving, color: cos.accent, cloak: cos.cloak, model: cos.model, dir, skin: getEquippedSkin() });

      // Title chip (fixed HUD) — the camp name. Account indicator + currency arrive in step 4.
      k.drawText({ text: "CAMP", pos: k.vec2(k.width() / 2, 22), anchor: "top", size: 16, font: "gameFont", color: k.rgb(...THEME.textMut), fixed: true });
    });

    // ESC → back to character select (temporary; account dropdown lands in step 4).
    k.onKeyPress("escape", () => { k.go("characterSelect"); });
  });
}
