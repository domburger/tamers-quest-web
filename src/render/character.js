// Animated player character drawn entirely with Kaboom primitives — no static
// sprite. Call inside onDraw() each frame; it animates from `t` (use k.time()):
// an idle bob when still, and a walk cycle (bobbing + alternating limbs) when
// `moving`. `color` is the body/tunic RGB.
export function drawCharacter(k, { x, y, t = 0, moving = false, color = [80, 140, 220] }) {
  const idle = Math.sin(t * 3) * 1.2;
  const step = moving ? Math.sin(t * 14) : 0; // limb swing phase
  const bob = moving ? Math.abs(Math.sin(t * 14)) * 3 : idle;
  const cx = x;
  const cy = y - bob;
  const dark = [Math.max(0, color[0] - 50), Math.max(0, color[1] - 50), Math.max(0, color[2] - 50)];

  // Ground shadow.
  k.drawEllipse({ pos: k.vec2(x, y + 16), radiusX: 13, radiusY: 4.5, color: k.rgb(0, 0, 0), opacity: 0.25 });

  // Legs (alternate while walking).
  k.drawRect({ pos: k.vec2(cx - 5, cy + 8 + step * 3), width: 5, height: 11, color: k.rgb(45, 55, 85), anchor: "center", radius: 2 });
  k.drawRect({ pos: k.vec2(cx + 5, cy + 8 - step * 3), width: 5, height: 11, color: k.rgb(45, 55, 85), anchor: "center", radius: 2 });

  // Arms (swing opposite the legs).
  k.drawRect({ pos: k.vec2(cx - 11, cy - step * 2), width: 4, height: 10, color: k.rgb(...dark), anchor: "center", radius: 2 });
  k.drawRect({ pos: k.vec2(cx + 11, cy + step * 2), width: 4, height: 10, color: k.rgb(...dark), anchor: "center", radius: 2 });

  // Body.
  k.drawEllipse({ pos: k.vec2(cx, cy), radiusX: 11, radiusY: 13, color: k.rgb(...color) });

  // Head.
  k.drawCircle({ pos: k.vec2(cx, cy - 15), radius: 8, color: k.rgb(232, 200, 165) });

  // Hat (brim + cap).
  k.drawEllipse({ pos: k.vec2(cx, cy - 19), radiusX: 11, radiusY: 4, color: k.rgb(120, 70, 50) });
  k.drawEllipse({ pos: k.vec2(cx, cy - 23), radiusX: 6, radiusY: 5, color: k.rgb(120, 70, 50) });
}
