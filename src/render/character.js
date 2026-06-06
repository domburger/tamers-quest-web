// Animated player character drawn entirely with Kaboom primitives — no static
// sprite. Call inside onDraw() each frame.
//
//   x, y     world position (feet/ground point)
//   t        animation clock (use k.time()); drives idle bob + walk cycle
//   moving   true while walking -> bobbing + alternating limbs + lantern sway
//   color    tunic RGB — used to tell players apart (self vs others)
//   dir      facing as {x,y} (e.g. movement vector). Mirrors left/right and
//            swaps to a back view when walking away from camera. Defaults front.
//
// Style: modern flat, two-tone shading (a lighter top plate over a darker base
// shape), with a warm lantern glow for the cave-crawler mood.
export function drawCharacter(k, { x, y, t = 0, moving = false, color = [80, 140, 220], dir = null }) {
  const rgb = (r, g, b) => k.rgb(r, g, b);
  const shade = (c, d) => [Math.max(0, c[0] + d), Math.max(0, c[1] + d), Math.max(0, c[2] + d)]
    .map((v) => Math.min(255, v));
  const tunic = color;
  const tunicDk = shade(tunic, -46);
  const tunicLt = shade(tunic, 26);

  // Facing -------------------------------------------------------------------
  const dx = dir ? dir.x : 0;
  const dy = dir ? dir.y : 1;
  const flip = dx < -0.15 ? -1 : 1;                 // mirror when heading left
  const back = dy < -0.35 && Math.abs(dy) >= Math.abs(dx); // walking away

  // Animation ----------------------------------------------------------------
  const idle = Math.sin(t * 3) * 1.0;
  const step = moving ? Math.sin(t * 13) : 0;       // limb swing phase (-1..1)
  const bob = moving ? Math.abs(Math.sin(t * 13)) * 2.6 : idle;
  const sway = (moving ? Math.sin(t * 13) * 1.4 : Math.sin(t * 2.2) * 0.8) * flip;
  const cx = x;
  const cy = y - bob;
  const fx = (o) => cx + o * flip;                  // mirror an x-offset

  // Ground shadow (soft, squashes a touch on each step) ----------------------
  k.drawEllipse({ pos: k.vec2(x, y + 16), radiusX: 13 - Math.abs(step) * 1.5, radiusY: 4.2,
    color: rgb(0, 0, 0), opacity: 0.22 });

  // Boots + legs (alternate while walking) -----------------------------------
  const legCol = rgb(...shade(tunicDk, -10));
  const bootCol = rgb(58, 44, 38);
  for (const s of [-1, 1]) {
    const ph = s * step * 3;
    k.drawRect({ pos: k.vec2(fx(s * 5), cy + 9 + ph), width: 6, height: 11,
      color: legCol, anchor: "center", radius: 3 });
    k.drawRect({ pos: k.vec2(fx(s * 5), cy + 15 + ph), width: 7, height: 5,
      color: bootCol, anchor: "center", radius: 2 });
  }

  // Backpack — full on the back view, an edge peeking on the front ----------
  if (back) {
    k.drawRect({ pos: k.vec2(cx, cy - 1), width: 20, height: 22, color: rgb(96, 74, 52),
      anchor: "center", radius: 6 });
    k.drawRect({ pos: k.vec2(cx, cy - 6), width: 20, height: 8, color: rgb(120, 94, 66),
      anchor: "center", radius: 4 });
    k.drawRect({ pos: k.vec2(cx, cy + 4), width: 12, height: 8, color: rgb(72, 54, 38),
      anchor: "center", radius: 3 });
  } else {
    // pack edge poking out behind the shoulder
    k.drawRect({ pos: k.vec2(fx(-9), cy - 3), width: 9, height: 16, color: rgb(96, 74, 52),
      anchor: "center", radius: 4 });
  }

  // Back arm (behind torso) --------------------------------------------------
  k.drawRect({ pos: k.vec2(fx(-10), cy - step * 2), width: 5, height: 12,
    color: rgb(...tunicDk), anchor: "center", radius: 3 });

  // Torso — darker base then a lighter top plate = flat two-tone shading -----
  k.drawEllipse({ pos: k.vec2(cx, cy + 1), radiusX: 11, radiusY: 13, color: rgb(...tunicDk) });
  k.drawEllipse({ pos: k.vec2(cx, cy - 2), radiusX: 10, radiusY: 10, color: rgb(...tunic) });
  k.drawEllipse({ pos: k.vec2(cx - 2.5 * flip, cy - 4), radiusX: 5, radiusY: 5,
    color: rgb(...tunicLt), opacity: 0.6 });

  // Belt + diagonal satchel strap (not on the back view) ---------------------
  if (!back) {
    k.drawRect({ pos: k.vec2(cx, cy + 7), width: 20, height: 4, color: rgb(58, 44, 38),
      anchor: "center", radius: 2 });
    k.drawLine({ p1: k.vec2(fx(-9), cy - 8), p2: k.vec2(fx(8), cy + 6),
      width: 3, color: rgb(120, 94, 66) });
  }

  // Front arm + glove --------------------------------------------------------
  const armY = cy + step * 2;
  k.drawRect({ pos: k.vec2(fx(10), armY), width: 5, height: 12, color: rgb(...tunic),
    anchor: "center", radius: 3 });
  k.drawCircle({ pos: k.vec2(fx(11), armY + 6), radius: 2.6, color: rgb(232, 200, 165) });

  // Lantern — the cave-crawler signature: warm glow + body, gently swinging ---
  const lx = fx(13) + sway;
  const ly = cy + 9 + (moving ? Math.abs(step) * 1.5 : 0);
  const glow = 0.5 + 0.25 * Math.sin(t * 4);
  k.drawCircle({ pos: k.vec2(lx, ly + 3), radius: 11, color: rgb(255, 196, 92), opacity: 0.18 * glow });
  k.drawCircle({ pos: k.vec2(lx, ly + 3), radius: 6, color: rgb(255, 214, 120), opacity: 0.35 * glow });
  k.drawLine({ p1: k.vec2(fx(11), armY + 5), p2: k.vec2(lx, ly), width: 1.5, color: rgb(70, 60, 50) });
  k.drawRect({ pos: k.vec2(lx, ly + 3), width: 6, height: 8, color: rgb(60, 52, 44), anchor: "center", radius: 2 });
  k.drawRect({ pos: k.vec2(lx, ly + 3), width: 4, height: 5, color: rgb(255, 222, 138), anchor: "center", radius: 1 });

  // Head ---------------------------------------------------------------------
  const hy = cy - 15;
  k.drawCircle({ pos: k.vec2(cx, hy), radius: 8, color: rgb(208, 176, 142) });        // shade base
  k.drawCircle({ pos: k.vec2(cx - 1.5 * flip, hy - 1), radius: 7, color: rgb(232, 200, 165) }); // lit
  if (!back) {
    // simple flat eyes
    k.drawCircle({ pos: k.vec2(fx(-3), hy), radius: 1.5, color: rgb(36, 30, 28) });
    k.drawCircle({ pos: k.vec2(fx(3), hy), radius: 1.5, color: rgb(36, 30, 28) });
  }

  // Explorer cap — brim + dome + accent band (band uses the tunic hue) -------
  const capCol = rgb(86, 62, 46);
  const capLt = rgb(112, 82, 60);
  k.drawEllipse({ pos: k.vec2(cx + 1 * flip, hy - 6), radiusX: 12, radiusY: 4, color: capCol }); // brim
  k.drawEllipse({ pos: k.vec2(cx, hy - 9), radiusX: 7, radiusY: 6, color: capCol });             // dome
  k.drawEllipse({ pos: k.vec2(cx - 2 * flip, hy - 11), radiusX: 4, radiusY: 3, color: capLt, opacity: 0.7 });
  k.drawRect({ pos: k.vec2(cx, hy - 6.5), width: 14, height: 2.5, color: rgb(...tunicLt), anchor: "center", radius: 1 });
}
