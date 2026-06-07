// Animated player character drawn entirely with Kaboom/shim primitives — no
// static sprite. A hooded, cloaked spirit-tamer (back-facing by default, like the
// concept art) holding a glowing spirit-chain ring. Call inside onDraw().
//
//   x, y     world position (feet/ground point)
//   t        animation clock (use k.time()) — cloak sway, bob, chain shimmer
//   moving   true while walking
//   color    accent RGB for the rim-light + spirit-chain glow — distinguishes
//            players (self vs others); the cloak itself stays dark for everyone
//   dir      facing {x,y}; mirrors L/R, shows a shadowed face only when facing
//            the camera (down), otherwise we see the hood from behind/side.
import { drawChainSkin, getEquippedSkin } from "./chainCosmetics.js";

export function drawCharacter(k, { x, y, t = 0, moving = false, color = [90, 170, 255], dir = null, skin = null, cloak: cloakIn = null }) {
  const C = (r, g, b) => k.rgb(r, g, b);
  const accent = color;
  const cloak = cloakIn || [24, 21, 34];          // dusky cloak (cosmetic-tintable)
  const cloakDk = cloak.map((v) => Math.round(v * 0.6)); // shadowed folds / hem
  const dx = dir ? dir.x : 0;
  const dy = dir ? dir.y : 1;
  const flip = dx < -0.15 ? -1 : 1;
  // We see the back/side unless clearly walking toward the camera (downward).
  const facingCamera = dy > 0.35 && Math.abs(dy) >= Math.abs(dx);

  const idle = Math.sin(t * 2.4) * 1.0;
  const step = moving ? Math.sin(t * 11) : 0;
  const bob = moving ? Math.abs(Math.sin(t * 11)) * 2.2 : idle;
  const hemSway = (moving ? Math.sin(t * 11) * 2 : Math.sin(t * 1.8) * 1.0) * flip;
  const cx = x;
  const cy = y - bob;
  const fx = (o) => cx + o * flip;

  // Ground shadow.
  k.drawEllipse({ pos: k.vec2(x, y + 15), radiusX: 13, radiusY: 4, color: C(0, 0, 0), opacity: 0.3 });

  // Lower cloak (wide, tapered) with a tattered, swaying hem.
  k.drawEllipse({ pos: k.vec2(cx, cy + 6), radiusX: 13, radiusY: 16, color: C(...cloak) });
  for (let i = -2; i <= 2; i++) {
    const hh = 5 + (Math.abs(i) % 2) * 4 + (i === 0 ? 3 : 0);
    k.drawRect({ pos: k.vec2(cx + i * 5 + hemSway * 0.4, cy + 18), width: 4.5, height: hh,
      color: C(...cloakDk), anchor: "center", radius: 1 });
  }

  // Upper cloak / shoulders, with a cool rim light down one edge.
  k.drawEllipse({ pos: k.vec2(cx, cy - 6), radiusX: 10, radiusY: 11, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(cx - 7 * flip, cy - 4), radiusX: 3, radiusY: 12, color: C(...accent), opacity: 0.16 });

  // Pointed hood / cowl.
  k.drawEllipse({ pos: k.vec2(cx, cy - 15), radiusX: 9, radiusY: 10, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(cx, cy - 20), radiusX: 5.5, radiusY: 6, color: C(...cloak) });
  k.drawEllipse({ pos: k.vec2(cx - 4 * flip, cy - 16), radiusX: 2.4, radiusY: 7, color: C(...accent), opacity: 0.14 });

  if (facingCamera) {
    // Shadowed face opening with two faint glowing eyes.
    k.drawEllipse({ pos: k.vec2(cx, cy - 14), radiusX: 5.5, radiusY: 6.5, color: C(...cloakDk) });
    k.drawCircle({ pos: k.vec2(fx(-2.2), cy - 14), radius: 1.4, color: C(...accent) });
    k.drawCircle({ pos: k.vec2(fx(2.2), cy - 14), radius: 1.4, color: C(...accent) });
  }

  // Spirit-chain ring held out to the side — the player's equipped cosmetic skin.
  const rx = fx(15);
  const ry = cy + 2 + (moving ? Math.abs(step) * 1.5 : Math.sin(t * 2.4));
  k.drawLine({ p1: k.vec2(fx(7), cy - 1), p2: k.vec2(rx, ry), width: 4, color: C(...cloak) }); // sleeve/arm
  // CN-12: render THIS character's skin (rivals pass their own); default to the
  // local player's equipped skin (single-player + self).
  drawChainSkin(k, { x: rx, y: ry, r: 7, t, skin: skin || getEquippedSkin() });
}
