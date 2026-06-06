// Procedural extraction portal — a rift of spirit-light that tears open and
// RISES from the ground when it spawns, then idles with a swirling vortex, a
// pulsing rim, an upward light beam, and orbiting motes. Pure Kaboom primitives
// (no sprites), world-space, drawn each frame from a scene's onDraw.
//
// drawPortal(k, { x, y, t, age }):
//   x,y  = world position of the portal's BASE (on the ground)
//   t    = animation clock (k.time())
//   age  = seconds since this portal spawned (drives the rise-up animation)

const RISE_S = 1.2;     // seconds to fully emerge from the ground
const BASE_W = 30;      // rift half-width at full size
const FULL_H = 56;      // rift height (ground → top) at full size
const TEAL = [90, 224, 255];
const CORE = [220, 250, 255];

const lerp = (a, b, u) => a + (b - a) * u;

export function drawPortal(k, { x, y, t, age = 999 }) {
  const col = (c, o = 1) => k.rgb(c[0], c[1], c[2]);
  // Ease-out rise 0→1; clamp.
  const r = Math.max(0, Math.min(1, age / RISE_S));
  const rise = 1 - (1 - r) * (1 - r); // easeOutQuad
  const pulse = 0.6 + 0.4 * Math.sin(t * 4);
  const opening = r < 1; // still tearing open

  const H = FULL_H * rise;
  const W = BASE_W * (0.35 + 0.65 * rise);
  const cy = y - H * 0.52; // rift centre floats above the base as it rises

  // 1) Ground rupture: a flat glowing pool + a hot crack line at the base. Brightest
  //    while opening, settles to a soft glow. Reads as "something tore the ground".
  k.drawEllipse({ pos: k.vec2(x, y), radiusX: W * 1.25, radiusY: 7 + 3 * pulse, color: col(TEAL), opacity: 0.18 + 0.12 * pulse });
  if (opening) {
    const crackW = lerp(2, W * 1.1, Math.min(1, r * 1.4));
    k.drawEllipse({ pos: k.vec2(x, y), radiusX: crackW, radiusY: 4, color: col(CORE), opacity: 0.5 * (1 - r) + 0.2 });
    // dust kicking up as it opens
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + t * 2;
      const dr = (1 - r) * 14;
      k.drawCircle({ pos: k.vec2(x + Math.cos(a) * (W * 0.6 + dr), y - Math.abs(Math.sin(a)) * dr), radius: 1.8 * (1 - r) + 0.5, color: col(TEAL), opacity: 0.35 * (1 - r) });
    }
  }

  if (rise < 0.04) return; // not yet emerged

  // 2) Upward light beam — a tall translucent shaft rising out of the rift.
  k.drawEllipse({ pos: k.vec2(x, cy - H * 0.2), radiusX: W * 0.5, radiusY: H * 0.9, color: col(TEAL), opacity: 0.10 * rise });

  // 3) The rift body: nested vesica-like ellipses → a glowing vortex (outer dark
  //    halo → teal body → white-hot core).
  k.drawEllipse({ pos: k.vec2(x, cy), radiusX: W * 1.15, radiusY: H * 0.6, color: col(TEAL), opacity: 0.16 });
  k.drawEllipse({ pos: k.vec2(x, cy), radiusX: W, radiusY: H * 0.5, color: col([40, 120, 170]), opacity: 0.55 });
  k.drawEllipse({ pos: k.vec2(x, cy), radiusX: W * 0.62, radiusY: H * 0.34, color: col(TEAL), opacity: 0.6 });
  k.drawEllipse({ pos: k.vec2(x, cy), radiusX: W * 0.28 * pulse, radiusY: H * 0.18 * pulse, color: col(CORE), opacity: 0.85 });

  // 4) Pulsing rim — a bright outline that breathes.
  k.drawEllipse({ pos: k.vec2(x, cy), radiusX: W, radiusY: H * 0.5, fill: false, outline: { width: 2, color: col(CORE) }, opacity: 0.35 + 0.35 * pulse });

  // 5) Swirling motes orbiting the rim (cheap vortex motion).
  const motes = 6;
  for (let i = 0; i < motes; i++) {
    const a = t * 2.2 + (i / motes) * Math.PI * 2;
    const mx = x + Math.cos(a) * W * 0.95;
    const my = cy + Math.sin(a) * H * 0.46;
    const near = (Math.sin(a) + 1) / 2; // front motes brighter/bigger
    k.drawCircle({ pos: k.vec2(mx, my), radius: 1 + 1.6 * near, color: col(CORE), opacity: (0.3 + 0.5 * near) * rise });
  }
}
