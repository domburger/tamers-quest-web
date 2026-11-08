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
  shop:    (d) => { d.line(-0.9, -0.75, 0.9, -0.75); d.line(-0.9, -0.75, -0.9, -0.35); d.line(0.9, -0.75, 0.9, -0.35); for (let i = 0; i < 4; i++) d.arc(-0.675 + i * 0.45, -0.35, 0.225, 0, Math.PI); d.line(-0.75, -0.1, -0.75, 0.85); d.line(0.75, -0.1, 0.75, 0.85); d.line(-0.9, 0.85, 0.9, 0.85); d.rect(-0.22, 0.3, 0.44, 0.55, false); }, // storefront: scalloped awning + door
  vault:   (d) => { d.rect(-0.8, -0.45, 1.6, 1.25, false); d.arc(0, -0.45, 0.8, Math.PI, Math.PI * 2); d.line(-0.8, 0.05, 0.8, 0.05); d.rect(-0.15, -0.05, 0.3, 0.3, true); }, // treasure chest: domed lid + clasp
  book:    (d) => { d.line(0, -0.6, 0, 0.75); d.poly([[0, -0.6], [-0.85, -0.78], [-0.85, 0.6], [0, 0.75]], false); d.poly([[0, -0.6], [0.85, -0.78], [0.85, 0.6], [0, 0.75]], false); },
  tailor:  (d) => { d.poly([[-0.95, 0.35], [0, -0.3], [0.95, 0.35]], false); d.line(-0.95, 0.35, 0.95, 0.35); d.arc(0, -0.55, 0.22, Math.PI * 0.2, Math.PI * 1.9); },
  pass:    (d) => { d.rect(-0.9, -0.5, 1.8, 1.0, false); d.circle(-0.9, 0, 0.18, false); d.circle(0.9, 0, 0.18, false); d.line(-0.3, -0.2, 0.45, -0.2); d.line(-0.3, 0.2, 0.2, 0.2); },
  market:  (d) => { d.line(0, -0.85, 0, 0.8); d.line(-0.75, 0.8, 0.75, 0.8); d.line(-0.75, -0.45, 0.75, -0.45); d.arc(-0.75, -0.05, 0.3, 0, Math.PI); d.arc(0.75, -0.05, 0.3, 0, Math.PI); },
  cog:     (d) => { d.circle(0, 0, 0.42, false); d.circle(0, 0, 0.12, true); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; d.line(Math.cos(a) * 0.6, Math.sin(a) * 0.6, Math.cos(a) * 0.9, Math.sin(a) * 0.9); } },
  person:  (d) => { d.circle(0, -0.4, 0.34, false); d.arc(0, 0.95, 0.78, Math.PI * 1.12, Math.PI * 1.88); },
  portal:  (d) => { d.circle(0, 0, 0.55, false); d.circle(0, 0, 0.2, true); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; d.line(Math.cos(a) * 0.72, Math.sin(a) * 0.72, Math.cos(a) * 0.95, Math.sin(a) * 0.95); } },
  heal:    (d) => { d.rect(-0.82, -0.82, 1.64, 1.64, false); d.line(0, -0.45, 0, 0.45); d.line(-0.45, 0, 0.45, 0); }, // medkit: cross in a rounded square (plus stays bare)
  map:     (d) => { d.circle(0, 0, 0.85, false); d.poly([[0, -0.6], [0.22, 0], [0, 0.6], [-0.22, 0]], true); },
  // ── economy ──
  coin:    (d) => { d.circle(0, 0, 0.8, false); d.circle(0, 0, 0.42, false); },
  gem:     (d) => { d.poly([[-0.85, -0.2], [-0.45, -0.75], [0.45, -0.75], [0.85, -0.2], [0, 0.85]], false); d.line(-0.85, -0.2, 0.85, -0.2); d.line(-0.45, -0.75, 0, 0.85); d.line(0.45, -0.75, 0, 0.85); },
  chain:   (d) => { d.circle(-0.35, 0, 0.42, false); d.circle(0.35, 0, 0.42, false); },
  bag:     (d) => { d.poly([[-0.6, -0.35], [0.6, -0.35], [0.85, 0.85], [-0.85, 0.85]], false); d.arc(0, -0.35, 0.32, Math.PI, Math.PI * 2); d.line(-0.3, 0.2, 0.3, 0.2); }, // satchel with a handle
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
  xp:      (d) => { d.poly([[-0.15, -0.9], [0.02, -0.25], [0.65, -0.08], [0.02, 0.09], [-0.15, 0.75], [-0.32, 0.09], [-0.95, -0.08], [-0.32, -0.25]], false); d.line(0.62, 0.42, 0.62, 0.9); d.line(0.38, 0.66, 0.86, 0.66); }, // sparkle (experience)
  // ── controls ──
  play:    (d) => { d.poly([[-0.55, -0.8], [0.8, 0], [-0.55, 0.8]], true); },
  chevronR:(d) => { d.line(-0.3, -0.65, 0.35, 0); d.line(0.35, 0, -0.3, 0.65); },
  chevronL:(d) => { d.line(0.3, -0.65, -0.35, 0); d.line(-0.35, 0, 0.3, 0.65); },
  chevronD:(d) => { d.line(-0.65, -0.3, 0, 0.35); d.line(0, 0.35, 0.65, -0.3); },
  check:   (d) => { d.line(-0.75, 0.05, -0.2, 0.6); d.line(-0.2, 0.6, 0.8, -0.55); },
  close:   (d) => { d.line(-0.6, -0.6, 0.6, 0.6); d.line(0.6, -0.6, -0.6, 0.6); },
  plus:    (d) => { d.line(-0.7, 0, 0.7, 0); d.line(0, -0.7, 0, 0.7); },
  minus:   (d) => { d.line(-0.7, 0, 0.7, 0); },
  lock:    (d) => { d.rect(-0.65, -0.1, 1.3, 0.95, false); d.line(-0.4, -0.1, -0.4, -0.4); d.line(0.4, -0.1, 0.4, -0.4); d.arc(0, -0.4, 0.4, Math.PI, Math.PI * 2); d.circle(0, 0.38, 0.1, true); }, // padlock: shackle ABOVE the body
  search:  (d) => { d.circle(-0.15, -0.15, 0.55, false); d.line(0.25, 0.25, 0.8, 0.8); },
  sort:    (d) => { d.line(-0.8, -0.5, 0.8, -0.5); d.line(-0.8, 0, 0.3, 0); d.line(-0.8, 0.5, -0.2, 0.5); },
  sound:   (d) => { d.poly([[-0.85, -0.3], [-0.4, -0.3], [0.1, -0.75], [0.1, 0.75], [-0.4, 0.3], [-0.85, 0.3]], true); d.arc(0.3, 0, 0.35, -Math.PI * 0.4, Math.PI * 0.4); d.arc(0.3, 0, 0.7, -Math.PI * 0.35, Math.PI * 0.35); },
  mute:    (d) => { d.poly([[-0.85, -0.3], [-0.4, -0.3], [0.1, -0.75], [0.1, 0.75], [-0.4, 0.3], [-0.85, 0.3]], true); d.line(0.35, -0.3, 0.9, 0.3); d.line(0.9, -0.3, 0.35, 0.3); },
  motion:  (d) => { d.circle(0.25, 0, 0.45, false); d.line(-0.9, -0.3, -0.35, -0.3); d.line(-0.9, 0, -0.45, 0); d.line(-0.9, 0.3, -0.35, 0.3); },
  shake:   (d) => { d.rect(-0.45, -0.65, 0.9, 1.3, false); d.line(-0.8, -0.3, -0.8, 0.3); d.line(0.8, -0.3, 0.8, 0.3); },
  keyboard:(d) => { d.rect(-0.9, -0.5, 1.8, 1.0, false); d.line(-0.5, -0.15, -0.5, -0.15); d.line(0, -0.15, 0, -0.15); d.line(0.5, -0.15, 0.5, -0.15); d.line(-0.4, 0.2, 0.4, 0.2); },
  external:(d) => { d.line(-0.2, -0.75, -0.8, -0.75); d.line(-0.8, -0.75, -0.8, 0.8); d.line(-0.8, 0.8, 0.75, 0.8); d.line(0.75, 0.8, 0.75, 0.2); d.line(0.1, -0.75, 0.8, -0.75); d.line(0.8, -0.75, 0.8, -0.05); d.line(0.8, -0.75, 0, 0.05); },
  solo:    (d) => { d.circle(0, -0.4, 0.34, false); d.arc(0, 0.95, 0.78, Math.PI * 1.12, Math.PI * 1.88); }, // one stroked figure (same family as person)
  multi:   (d) => { d.circle(-0.22, -0.4, 0.3, false); d.arc(-0.22, 0.95, 0.68, Math.PI * 1.12, Math.PI * 1.88); d.arc(0.42, -0.4, 0.3, Math.PI * 1.55, Math.PI * 2.45); d.arc(0.42, 0.95, 0.68, Math.PI * 1.6, Math.PI * 1.88); }, // two stroked figures, the second behind the first
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

// RETAINED support: rasterize an icon once into a texture (`k.loadSprite`) so menus built from retained
// objects (hub account dropdown, ESC menus) can place it with `k.sprite(key)`. Returns the sprite key, or
// null without a DOM. Cached per (name, size, colour). Drawn at 2× for crisp edges — place it with
// `k.scale(0.5)` or set width/height = size.
const _spriteCache = new Map();
export function iconSpriteKey(k, name, { size = 24, color = [255, 255, 255] } = {}) {
  if (typeof document === "undefined" || !ICONS[name]) return null;
  const key = `icon:${name}:${size}:${color.join(",")}`;
  if (_spriteCache.has(key)) return key;
  try {
    const S = 2, cv = document.createElement("canvas");
    cv.width = cv.height = Math.ceil(size * S);
    const ctx = cv.getContext("2d");
    ctx.scale(S, S);
    const col = color;
    const rgba = (o) => `rgba(${col[0]},${col[1]},${col[2]},${o ?? 1})`;
    // A tiny immediate adapter over the 2D context (only what drawIcon uses).
    const kk = {
      vec2: (x, y) => ({ x, y }), rgb: () => col,
      drawLine: ({ p1, p2, width, opacity }) => { ctx.strokeStyle = rgba(opacity); ctx.lineWidth = width; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); },
      drawCircle: ({ pos, radius, opacity, fill, outline }) => { ctx.beginPath(); ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2); if (fill !== false) { ctx.fillStyle = rgba(opacity); ctx.fill(); } if (outline) { ctx.strokeStyle = rgba(opacity); ctx.lineWidth = outline.width; ctx.stroke(); } },
      drawRect: ({ pos, width, height, radius, opacity, fill, outline }) => { const r = Math.min(radius || 0, width / 2, height / 2); ctx.beginPath(); ctx.moveTo(pos.x + r, pos.y); ctx.arcTo(pos.x + width, pos.y, pos.x + width, pos.y + height, r); ctx.arcTo(pos.x + width, pos.y + height, pos.x, pos.y + height, r); ctx.arcTo(pos.x, pos.y + height, pos.x, pos.y, r); ctx.arcTo(pos.x, pos.y, pos.x + width, pos.y, r); ctx.closePath(); if (fill !== false) { ctx.fillStyle = rgba(opacity); ctx.fill(); } if (outline) { ctx.strokeStyle = rgba(opacity); ctx.lineWidth = outline.width; ctx.stroke(); } },
      drawPolygon: ({ pts, opacity }) => { ctx.fillStyle = rgba(opacity); ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill(); },
    };
    drawIcon(kk, name, { x: size / 2, y: size / 2, size: size * 0.8, color: col });
    k.loadSprite(key, cv);
    _spriteCache.set(key, true);
    return key;
  } catch { return null; }
}
