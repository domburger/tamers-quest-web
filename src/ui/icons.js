// UI v4 ICON SET — a drawn, stroke-based icon library for the canvas UI (no glyph text, no image assets).
// Every icon is authored in a unit box (-1..1, y down) and rendered with rounded 2px-ish strokes at any
// size, in any colour, so icons track the theme like text does. `drawIcon(k, name, { x, y, size, color,
// opacity, fixed, weight })` draws the icon CENTRED on (x, y) inside a `size`×`size` box.
//
// Style rules: 2-unit stroke on a 24px icon (weight scales with size), round caps (the backend's drawLine
// uses round caps), minimal detail, filled shapes only where a silhouette reads better (heart, bolt, play).
// Keep the set small and consistent — one visual language across sheets, rail, HUD and combat.

const ICONS = {
  // ── places / stations ──
  village: (d) => { d.poly([[-0.9, 0.1], [0, -0.85], [0.9, 0.1]], false); d.rect(-0.62, 0.1, 1.24, 0.78, false); d.rect(-0.16, 0.36, 0.32, 0.52, true); },
  shop:    (d) => { d.poly([[-0.95, 0.75], [0, -0.85], [0.95, 0.75]], false); d.line(-0.95, 0.75, 0.95, 0.75); d.line(0, -0.85, 0, 0.75); d.line(-0.4, 0.75, -0.4, 0.15); d.line(0.4, 0.75, 0.4, 0.15); },
  vault:   (d) => { d.rect(-0.7, -0.35, 1.4, 1.15, false); d.arc(0, -0.35, 0.42, Math.PI, 0); d.line(-0.7, 0.1, 0.7, 0.1); d.circle(0, 0.35, 0.1, true); },
  book:    (d) => { d.line(0, -0.6, 0, 0.75); d.poly([[0, -0.6], [-0.85, -0.78], [-0.85, 0.6], [0, 0.75]], false); d.poly([[0, -0.6], [0.85, -0.78], [0.85, 0.6], [0, 0.75]], false); },
  tailor:  (d) => { d.poly([[-0.95, 0.35], [0, -0.3], [0.95, 0.35]], false); d.line(-0.95, 0.35, 0.95, 0.35); d.arc(0, -0.55, 0.22, Math.PI * 0.2, Math.PI * 1.9); },
  pass:    (d) => { d.rect(-0.9, -0.5, 1.8, 1.0, false); d.circle(-0.9, 0, 0.18, false); d.circle(0.9, 0, 0.18, false); d.line(-0.3, -0.2, 0.45, -0.2); d.line(-0.3, 0.2, 0.2, 0.2); },
  market:  (d) => { d.line(0, -0.85, 0, 0.8); d.line(-0.75, 0.8, 0.75, 0.8); d.line(-0.75, -0.45, 0.75, -0.45); d.arc(-0.75, -0.05, 0.3, 0, Math.PI); d.arc(0.75, -0.05, 0.3, 0, Math.PI); },
  cog:     (d) => { d.circle(0, 0, 0.42, false); d.circle(0, 0, 0.12, true); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; d.line(Math.cos(a) * 0.6, Math.sin(a) * 0.6, Math.cos(a) * 0.9, Math.sin(a) * 0.9); } },
  person:  (d) => { d.circle(0, -0.4, 0.34, false); d.arc(0, 0.95, 0.78, Math.PI * 1.12, Math.PI * 1.88); },
  portal:  (d) => { d.circle(0, 0, 0.55, false); d.circle(0, 0, 0.2, true); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; d.line(Math.cos(a) * 0.72, Math.sin(a) * 0.72, Math.cos(a) * 0.95, Math.sin(a) * 0.95); } },
  heal:    (d) => { d.line(0, -0.8, 0, 0.8); d.line(-0.8, 0, 0.8, 0); },
  map:     (d) => { d.circle(0, 0, 0.85, false); d.poly([[0, -0.6], [0.22, 0], [0, 0.6], [-0.22, 0]], true); },
  // ── economy ──
  coin:    (d) => { d.circle(0, 0, 0.8, false); d.circle(0, 0, 0.42, false); },
  gem:     (d) => { d.poly([[-0.85, -0.2], [-0.45, -0.75], [0.45, -0.75], [0.85, -0.2], [0, 0.85]], false); d.line(-0.85, -0.2, 0.85, -0.2); d.line(-0.45, -0.75, 0, 0.85); d.line(0.45, -0.75, 0, 0.85); },
  chain:   (d) => { d.circle(-0.35, 0, 0.42, false); d.circle(0.35, 0, 0.42, false); },
  bag:     (d) => { d.rect(-0.75, -0.3, 1.5, 1.1, false); d.arc(0, -0.3, 0.4, Math.PI, 0); d.line(-0.75, 0.05, 0.75, 0.05); },
  // ── combat ──
  sword:   (d) => { d.line(-0.75, 0.75, 0.55, -0.55); d.line(0.55, -0.55, 0.85, -0.85); d.line(-0.15, -0.35, 0.35, 0.15); d.line(-0.85, 0.5, -0.5, 0.85); },
  shield:  (d) => { d.poly([[0, -0.85], [0.8, -0.5], [0.7, 0.2], [0, 0.85], [-0.7, 0.2], [-0.8, -0.5]], false); d.line(0, -0.4, 0, 0.4); },
  heart:   (d) => { d.circle(-0.4, -0.3, 0.42, true); d.circle(0.4, -0.3, 0.42, true); d.poly([[-0.8, -0.15], [0.8, -0.15], [0, 0.85]], true); },
  bolt:    (d) => { d.poly([[0.2, -0.95], [-0.6, 0.15], [-0.05, 0.15], [-0.25, 0.95], [0.6, -0.2], [0.05, -0.2]], true); },
  swap:    (d) => { d.line(-0.8, -0.35, 0.6, -0.35); d.line(0.6, -0.35, 0.25, -0.7); d.line(0.6, -0.35, 0.25, 0); d.line(0.8, 0.35, -0.6, 0.35); d.line(-0.6, 0.35, -0.25, 0); d.line(-0.6, 0.35, -0.25, 0.7); },
  flee:    (d) => { d.line(-0.2, -0.85, -0.85, -0.85); d.line(-0.85, -0.85, -0.85, 0.85); d.line(-0.85, 0.85, -0.2, 0.85); d.line(-0.3, 0, 0.9, 0); d.line(0.9, 0, 0.45, -0.45); d.line(0.9, 0, 0.45, 0.45); },
  catch:   (d) => { d.circle(0, 0, 0.75, false); d.circle(0, 0, 0.22, true); d.line(-0.75, 0, -0.22, 0); d.line(0.22, 0, 0.75, 0); },
  skull:   (d) => { d.circle(0, -0.2, 0.62, false); d.rect(-0.35, 0.3, 0.7, 0.45, false); d.circle(-0.24, -0.25, 0.12, true); d.circle(0.24, -0.25, 0.12, true); },
  // ── HUD / status ──
  clock:   (d) => { d.circle(0, 0, 0.85, false); d.line(0, -0.5, 0, 0.05); d.line(0, 0.05, 0.4, 0.3); },
  flag:    (d) => { d.line(-0.65, -0.9, -0.65, 0.9); d.poly([[-0.65, -0.85], [0.75, -0.45], [-0.65, -0.05]], true); },
  region:  (d) => { d.poly([[-0.9, 0.8], [-0.3, -0.6], [0.2, 0.3], [0.5, -0.1], [0.9, 0.8]], false); d.line(-0.9, 0.8, 0.9, 0.8); },
  trophy:  (d) => { d.rect(-0.5, -0.85, 1.0, 0.9, false); d.line(-0.5, -0.6, -0.85, -0.6); d.arc(-0.85, -0.3, 0.3, Math.PI * 0.5, Math.PI * 1.5); d.line(0.5, -0.6, 0.85, -0.6); d.arc(0.85, -0.3, 0.3, -Math.PI * 0.5, Math.PI * 0.5); d.line(0, 0.05, 0, 0.5); d.line(-0.45, 0.8, 0.45, 0.8); d.line(-0.45, 0.8, -0.3, 0.5); d.line(0.45, 0.8, 0.3, 0.5); },
  xp:      (d) => { d.line(-0.75, 0.75, 0.75, -0.75); d.line(0.75, -0.75, 0.1, -0.75); d.line(0.75, -0.75, 0.75, -0.1); d.line(-0.75, -0.2, -0.75, 0.75); d.line(-0.75, 0.75, 0.2, 0.75); },
  // ── controls ──
  play:    (d) => { d.poly([[-0.55, -0.8], [0.8, 0], [-0.55, 0.8]], true); },
  chevronR:(d) => { d.line(-0.3, -0.65, 0.35, 0); d.line(0.35, 0, -0.3, 0.65); },
  chevronL:(d) => { d.line(0.3, -0.65, -0.35, 0); d.line(-0.35, 0, 0.3, 0.65); },
  chevronD:(d) => { d.line(-0.65, -0.3, 0, 0.35); d.line(0, 0.35, 0.65, -0.3); },
  check:   (d) => { d.line(-0.75, 0.05, -0.2, 0.6); d.line(-0.2, 0.6, 0.8, -0.55); },
  close:   (d) => { d.line(-0.6, -0.6, 0.6, 0.6); d.line(0.6, -0.6, -0.6, 0.6); },
  plus:    (d) => { d.line(-0.7, 0, 0.7, 0); d.line(0, -0.7, 0, 0.7); },
  minus:   (d) => { d.line(-0.7, 0, 0.7, 0); },
  lock:    (d) => { d.rect(-0.65, -0.1, 1.3, 0.95, false); d.arc(0, -0.1, 0.42, Math.PI, 0); d.circle(0, 0.38, 0.1, true); },
  search:  (d) => { d.circle(-0.15, -0.15, 0.55, false); d.line(0.25, 0.25, 0.8, 0.8); },
  sort:    (d) => { d.line(-0.8, -0.5, 0.8, -0.5); d.line(-0.8, 0, 0.3, 0); d.line(-0.8, 0.5, -0.2, 0.5); },
  sound:   (d) => { d.poly([[-0.85, -0.3], [-0.4, -0.3], [0.1, -0.75], [0.1, 0.75], [-0.4, 0.3], [-0.85, 0.3]], true); d.arc(0.3, 0, 0.35, -Math.PI * 0.4, Math.PI * 0.4); d.arc(0.3, 0, 0.7, -Math.PI * 0.35, Math.PI * 0.35); },
  mute:    (d) => { d.poly([[-0.85, -0.3], [-0.4, -0.3], [0.1, -0.75], [0.1, 0.75], [-0.4, 0.3], [-0.85, 0.3]], true); d.line(0.35, -0.3, 0.9, 0.3); d.line(0.9, -0.3, 0.35, 0.3); },
  motion:  (d) => { d.circle(0.25, 0, 0.45, false); d.line(-0.9, -0.3, -0.35, -0.3); d.line(-0.9, 0, -0.45, 0); d.line(-0.9, 0.3, -0.35, 0.3); },
  shake:   (d) => { d.rect(-0.45, -0.65, 0.9, 1.3, false); d.line(-0.8, -0.3, -0.8, 0.3); d.line(0.8, -0.3, 0.8, 0.3); },
  keyboard:(d) => { d.rect(-0.9, -0.5, 1.8, 1.0, false); d.line(-0.5, -0.15, -0.5, -0.15); d.line(0, -0.15, 0, -0.15); d.line(0.5, -0.15, 0.5, -0.15); d.line(-0.4, 0.2, 0.4, 0.2); },
  external:(d) => { d.line(-0.2, -0.75, -0.8, -0.75); d.line(-0.8, -0.75, -0.8, 0.8); d.line(-0.8, 0.8, 0.75, 0.8); d.line(0.75, 0.8, 0.75, 0.2); d.line(0.1, -0.75, 0.8, -0.75); d.line(0.8, -0.75, 0.8, -0.05); d.line(0.8, -0.75, 0, 0.05); },
  solo:    (d) => { d.circle(0, -0.42, 0.3, true); d.rect(-0.45, 0.05, 0.9, 0.8, true); },
  multi:   (d) => { d.circle(-0.5, -0.1, 0.22, true); d.rect(-0.82, 0.25, 0.64, 0.6, true); d.circle(0.5, -0.1, 0.22, true); d.rect(0.18, 0.25, 0.64, 0.6, true); d.circle(0, -0.48, 0.28, true); d.rect(-0.4, -0.05, 0.8, 0.9, true); },
  journey: (d) => { d.line(-0.85, 0.7, -0.35, 0.1); d.line(-0.35, 0.1, 0.1, 0.55); d.line(0.1, 0.55, 0.5, -0.15); d.line(0.5, -0.15, 0.85, -0.7); d.circle(0.85, -0.7, 0.18, true); d.circle(-0.85, 0.7, 0.14, true); },
  info:    (d) => { d.circle(0, 0, 0.85, false); d.line(0, -0.05, 0, 0.5); d.circle(0, -0.42, 0.09, true); },
  dot:     (d) => { d.circle(0, 0, 0.35, true); },
};

export const ICON_NAMES = Object.keys(ICONS);
export function hasIcon(name) { return !!ICONS[name]; }

/**
 * Draw an icon centred on (x, y). `size` = box size in design px (default 24); `weight` = stroke width
 * at that size (default scales from 2px @ 24). Unknown names draw nothing (never throw in a frame).
 */
export function drawIcon(k, name, { x, y, size = 24, color = [255, 255, 255], opacity = 1, fixed = false, weight = null } = {}) {
  const fn = ICONS[name];
  if (!fn) return false;
  const s = size / 2, w = weight != null ? weight : Math.max(1.2, size / 12);
  const col = Array.isArray(color) ? k.rgb(color[0], color[1], color[2]) : color;
  const P = (ux, uy) => k.vec2(x + ux * s, y + uy * s);
  const d = {
    line: (ax, ay, bx, by) => k.drawLine({ p1: P(ax, ay), p2: P(bx, by), width: w, color: col, opacity, fixed }),
    circle: (cx, cy, r, fill) => (fill
      ? k.drawCircle({ pos: P(cx, cy), radius: r * s, color: col, opacity, fixed })
      : k.drawCircle({ pos: P(cx, cy), radius: r * s, color: col, opacity, fill: false, outline: { width: w, color: col }, fixed })),
    rect: (rx, ry, rw, rh, fill) => (fill
      ? k.drawRect({ pos: P(rx, ry), width: rw * s, height: rh * s, radius: Math.min(rw, rh) * s * 0.18, color: col, opacity, fixed })
      : k.drawRect({ pos: P(rx, ry), width: rw * s, height: rh * s, radius: Math.min(rw, rh) * s * 0.18, color: col, opacity, fill: false, outline: { width: w, color: col }, fixed })),
    // Open polyline (fill=false) or filled polygon. Outlines are drawn as a closed stroke of line segments.
    poly: (pts, fill) => {
      if (fill) { k.drawPolygon({ pts: pts.map(([ux, uy]) => P(ux, uy)), color: col, opacity, fixed }); return; }
      for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; d.line(a[0], a[1], b[0], b[1]); }
    },
    // Arc as a short polyline (stroke), from angle a0 to a1 (radians, y down).
    arc: (cx, cy, r, a0, a1) => {
      const n = Math.max(4, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 8)));
      let px = cx + Math.cos(a0) * r, py = cy + Math.sin(a0) * r;
      for (let i = 1; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; const nx = cx + Math.cos(a) * r, ny = cy + Math.sin(a) * r; d.line(px, py, nx, ny); px = nx; py = ny; }
    },
  };
  fn(d);
  return true;
}
