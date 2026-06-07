// Screen-space mood overlay for the world view (PV-T4). Gives the flat top-down
// map the haunted, bioluminescent feel of the concept art: a vignette that sinks
// the edges into darkness, a soft teal spirit-light around the player (screen
// centre), and drifting spirit motes. Self-contained (own canvas gen, no engine
// imports) to limit merge conflicts. Call from a scene's onDraw AFTER the world +
// entities and BEFORE the HUD (HUD is retained at z=100, so it stays on top).

import { prefersReducedMotion } from "../systems/a11y.js";

let _ready = false;
const makeCanvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

function genVignette() {
  const S = 512, c = makeCanvas(S, S), x = c.getContext("2d");
  // VS-11: softer, flatter falloff. Keep the inner ~60% light (≤0.4 alpha) and
  // push the dark band outward so the corner HUD (top-left health/info) and the
  // corner rivals stay readable; ease the edge to ~0.7 (was a near-opaque 0.92)
  // so the haunted mood survives without swallowing the corners.
  const g = x.createRadialGradient(S / 2, S / 2, S * 0.18, S / 2, S / 2, S * 0.66);
  g.addColorStop(0, "rgba(6,5,12,0)");
  g.addColorStop(0.55, "rgba(6,5,12,0.16)");
  g.addColorStop(0.8, "rgba(5,4,10,0.40)");
  g.addColorStop(1, "rgba(4,3,9,0.70)");
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  return c;
}
function genGlow(tint) {
  const S = 512, c = makeCanvas(S, S), x = c.getContext("2d");
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, `rgba(${tint},0.22)`);
  g.addColorStop(0.5, `rgba(${tint},0.07)`);
  g.addColorStop(1, `rgba(${tint},0)`);
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  return c;
}
// Danger vignette: clear centre, red-hot edges. Pulsed over the screen while the
// player is caught in the storm so the damage zone is felt, not just shown.
function genDanger() {
  const S = 512, c = makeCanvas(S, S), x = c.getContext("2d");
  const g = x.createRadialGradient(S / 2, S / 2, S * 0.28, S / 2, S / 2, S * 0.72);
  g.addColorStop(0, "rgba(220,50,50,0)");
  g.addColorStop(0.7, "rgba(214,46,46,0.14)");
  g.addColorStop(1, "rgba(230,60,60,0.46)");
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  return c;
}

export function ensureAtmosphere(k) {
  if (_ready) return;
  try {
    k.loadSprite("fx_vignette", genVignette());
    k.loadSprite("fx_glow", genGlow("90,230,200"));
    k.loadSprite("fx_danger", genDanger());
    _ready = true;
  } catch { /* sprites already registered */ _ready = true; }
}

// t = k.time(); danger fades the spirit-glow toward red when set (0..1).
export function drawAtmosphere(k, { t = 0, glow = true, danger = 0 } = {}) {
  ensureAtmosphere(k);
  const W = k.width(), H = k.height();
  const cover = Math.max(W, H) * 1.5;
  // a11y: honor "reduce motion" — freeze the glow's breathing pulse and drop the
  // drifting motes (decorative continuous motion); the static vignette + glow stay.
  const reduce = prefersReducedMotion();

  // Spirit-light glow around the player (screen centre), gently pulsing.
  if (glow && _ready) {
    const pulse = reduce ? 1 : 1 + 0.05 * Math.sin(t * 2.2);
    try {
      k.drawSprite({ sprite: "fx_glow", pos: k.vec2(W / 2, H / 2), anchor: "center",
        width: H * 1.9 * pulse, height: H * 1.9 * pulse, fixed: true, opacity: 0.55 * (1 - danger) });
    } catch { /* not ready yet */ }
  }

  // Vignette — a big soft radial darkening the screen edges.
  if (_ready) {
    try {
      k.drawSprite({ sprite: "fx_vignette", pos: k.vec2(W / 2, H / 2), anchor: "center",
        width: cover, height: cover, fixed: true });
    } catch { /* not ready yet */ }
  }

  // Danger: caught in the storm → a pulsing red edge vignette so the damage zone
  // is felt. Urgency conveyed by the pulse rate (frozen under reduce-motion).
  if (danger > 0 && _ready) {
    const dp = reduce ? 0.6 : 0.45 + 0.55 * Math.abs(Math.sin(t * 4));
    try {
      k.drawSprite({ sprite: "fx_danger", pos: k.vec2(W / 2, H / 2), anchor: "center",
        width: cover, height: cover, fixed: true, opacity: Math.min(1, dp * danger) });
    } catch { /* not ready yet */ }
  }

  // Drifting spirit motes (deterministic; slow upward drift + horizontal sway).
  // Skipped under reduce-motion — this is the main source of continuous motion.
  if (!reduce) {
    const col = danger > 0.5 ? k.rgb(255, 120, 120) : k.rgb(150, 255, 230);
    for (let i = 0; i < 26; i++) {
      const seed = i * 97.13;
      const baseX = (Math.sin(seed) * 0.5 + 0.5) * W;
      const speed = 8 + (i % 5) * 3;
      const y = H - (((t * speed + i * 53) % (H + 40)));
      const x = baseX + Math.sin(t * 0.6 + i) * 14;
      const a = 0.08 + 0.16 * (0.5 + 0.5 * Math.sin(t * 1.3 + i));
      k.drawCircle({ pos: k.vec2(x, y), radius: i % 4 === 0 ? 1.8 : 1.1, color: col, opacity: a, fixed: true });
    }
  }
}
