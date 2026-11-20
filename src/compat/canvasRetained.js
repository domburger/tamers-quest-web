import { toRGB, anchorOrigin } from "./canvasRenderer.js";

let _seq = 0;

export class CanvasObj {
  constructor(rec = {}) {
    this.id = ++_seq;
    this.kind = rec.kind || "rect";
    this.x = rec.x || 0; this.y = rec.y || 0;
    this.w = rec.w || 0; this.h = rec.h || 0;
    this.radius = rec.radius || 0;
    this._color = toRGB(rec.color);
    this._opacity = rec.opacity ?? 1;
    this._text = rec.text != null ? String(rec.text) : "";
    this.size = rec.size || 16; this.font = rec.font || "sans-serif"; this.anchor = rec.anchor || "topleft";
    this.wrap = rec.wrap || 0;
    this.fixed = !!rec.fixed;
    this._scale = rec.scale ?? 1; this._angle = rec.angle || 0;
    this.z = rec.z || 0; this._hidden = !!rec.hidden;
    this.outline = rec.outline || null; this.sprite = rec.sprite || null;
    this.gradient = rec.gradient || null; this.shadow = rec.shadow || null; this.fill = rec.fill;
    this.tags = Array.isArray(rec.tags) ? rec.tags.slice() : [];
    this._on = { click: [], hover: [], hoverUpdate: [], hoverEnd: [] };
    this._dead = false;
  }
  get pos() { return { x: this.x, y: this.y }; }
  set pos(v) { if (v) { this.x = v.x || 0; this.y = v.y || 0; } }
  get width() { return this.w; }   set width(v) { this.w = v; }
  get height() { return this.h; }  set height(v) { this.h = v; }
  get color() { return this._color; }     set color(c) { this._color = toRGB(c); }
  get opacity() { return this._opacity; } set opacity(o) { this._opacity = o; }
  get text() { return this._text; }       set text(t) { this._text = t == null ? "" : String(t); }
  get scale() { return this._scale; }     set scale(s) { this._scale = s; }
  get angle() { return this._angle; }     set angle(a) { this._angle = a; }
  get hidden() { return this._hidden; }   set hidden(v) { this._hidden = !!v; }
  is(tag) { return this.tags.includes(tag); }
  destroy() { this._dead = true; }
  onClick(cb) { if (cb) this._on.click.push(cb); return this; }
  onHover(cb) { if (cb) this._on.hover.push(cb); return this; }
  onHoverUpdate(cb) { if (cb) this._on.hoverUpdate.push(cb); return this; }
  onHoverEnd(cb) { if (cb) this._on.hoverEnd.push(cb); return this; }
  get interactive() { return !!(this._on.click.length || this._on.hover.length || this._on.hoverUpdate.length || this._on.hoverEnd.length); }
  contains(px, py) {
    if (this._hidden || this._dead) return false;
    if (this.kind === "circle") {
      const dx = px - this.x, dy = py - this.y, r = this.radius;
      return dx * dx + dy * dy <= r * r;
    }
    if (!(this.w > 0 && this.h > 0)) return false;
    const [ox, oy] = anchorOrigin(this.anchor);
    const left = this.x - this.w * ox, top = this.y - this.h * oy;
    return px >= left && px <= left + this.w && py >= top && py <= top + this.h;
  }
}

function drawObj(r, o, cam) {
  const shift = o.fixed ? { dx: 0, dy: 0 } : cam;
  const pos = { x: o.x + shift.dx, y: o.y + shift.dy }, color = o._color, opacity = o._opacity;
  if (o.kind === "circle") r.drawCircle({ pos, radius: o.radius, color, opacity, fill: o.fill !== false, outline: o.outline });
  else if (o.kind === "text") r.drawText({ pos, text: o._text, size: o.size, color, opacity, anchor: o.anchor, font: o.font, width: o.wrap || 0 });
  else if (o.kind === "sprite") r.drawSprite({ pos, sprite: o.sprite, width: o.w || undefined, height: o.h || undefined, scale: o._scale, angle: o._angle, anchor: o.anchor, opacity });
  else r.drawRect({ pos, width: o.w, height: o.h, color, opacity, radius: o.radius, anchor: o.anchor, fill: o.fill !== false, outline: o.outline, gradient: o.gradient || null, shadow: o.shadow || null });
}

export function makeRetainedLayer() {
  let objs = [];
  let hovered = null;
  function topAt(x, y) {
    let best = null;
    for (const o of objs) {
      if (o._dead || o._hidden || !o.interactive || !o.contains(x, y)) continue;
      if (!best || o.z > best.z || (o.z === best.z && o.id > best.id)) best = o;
    }
    return best;
  }
  return {
    add(rec) { const o = new CanvasObj(rec); objs.push(o); return o; },
    remove(o) { const i = objs.indexOf(o); if (i >= 0) { objs[i]._dead = true; objs.splice(i, 1); } },
    destroyAll(tag) {
      if (tag == null) { objs.forEach((o) => { o._dead = true; }); objs = []; return; }
      objs = objs.filter((o) => { if (o.is(tag)) { o._dead = true; return false; } return true; });
    },
    objects() { return objs.slice(); },
    count() { return objs.length; },
    render(renderer, cam = { dx: 0, dy: 0 }, range = null) {
      const below = range && range.below != null ? range.below : null;
      const from = range && range.from != null ? range.from : null;
      const live = objs.filter((o) => !o._dead && !o._hidden && (below != null ? o.z < below : from != null ? o.z >= from : true));
      live.sort((a, b) => (a.z - b.z) || (a.id - b.id));
      for (const o of live) drawObj(renderer, o, cam);
    },
    pointerDown(x, y) {
      const o = topAt(x, y);
      if (o) for (const cb of o._on.click) cb(o);
      return o;
    },
    pointerMove(x, y) {
      const o = topAt(x, y);
      if (o !== hovered) {
        if (hovered && !hovered._dead) for (const cb of hovered._on.hoverEnd) cb(hovered);
        hovered = o;
        if (o) for (const cb of o._on.hover) cb(o);
      }
      if (o) for (const cb of o._on.hoverUpdate) cb(o);
      return o;
    },
    hovered() { return hovered; },
  };
}
