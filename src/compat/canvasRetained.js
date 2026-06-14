// TQ-276 (Phase 3, engine-removal TQ-227/230): the retained-object layer (k.add/KObj) for the canvas
// backend. A pure store of draw records (rect/rounded-rect/circle/text/sprite) re-rendered EACH FRAME in
// z-order through the TQ-274 canvas renderer. CanvasObj exposes the same getter/setter surface as the
// Phaser-shim KObj (pos/width/height/color/opacity/text/scale/angle/hidden/z) so scenes' k.add code works
// unchanged. Hit-testing (onClick/onHover) + clip (pushClip/popClip) are separate Phase-3 leaves.
// No DOM, no Phaser — operates on the design-coord renderer; the runtime owns DPR/FIT.
import { toRGB, anchorOrigin } from "./canvasRenderer.js";

let _seq = 0;

/**
 * A retained draw object — the canvas-backend analogue of the shim's KObj (k.add return value). Holds
 * its comps as plain fields; getters/setters mirror the shim surface (pos is a {x,y} in design coords).
 */
export class CanvasObj {
  constructor(rec = {}) {
    this.id = ++_seq;                       // stable insertion order (z tie-break)
    this.kind = rec.kind || "rect";         // rect | circle | text | sprite
    this.x = rec.x || 0; this.y = rec.y || 0;
    this.w = rec.w || 0; this.h = rec.h || 0;
    this.radius = rec.radius || 0;          // rounded-rect corner (rect) OR circle radius (circle)
    this._color = toRGB(rec.color);
    this._opacity = rec.opacity ?? 1;
    this._text = rec.text != null ? String(rec.text) : "";
    this.size = rec.size || 16; this.font = rec.font || "sans-serif"; this.anchor = rec.anchor || "topleft";
    this._scale = rec.scale ?? 1; this._angle = rec.angle || 0;
    this.z = rec.z || 0; this._hidden = !!rec.hidden;
    this.outline = rec.outline || null; this.sprite = rec.sprite || null;
    this.tags = Array.isArray(rec.tags) ? rec.tags.slice() : [];
    this._on = { click: [], hover: [], hoverEnd: [] }; // TQ-277: interactivity handlers
    this._dead = false;
  }
  // ── KObj-compatible getter/setter surface (design coords) ──
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
  // ── TQ-277: interactivity (chainable, mirroring the shim KObj) ──
  onClick(cb) { if (cb) this._on.click.push(cb); return this; }
  onHover(cb) { if (cb) this._on.hover.push(cb); return this; }
  onHoverEnd(cb) { if (cb) this._on.hoverEnd.push(cb); return this; }
  /** True if this object listens for any pointer event (so hit-testing can ignore inert decor). */
  get interactive() { return !!(this._on.click.length || this._on.hover.length || this._on.hoverEnd.length); }
  /**
   * Anchor-aware point-in-shape test in DESIGN coords: point-in-circle for circle kind; an anchored
   * box for rect/text/sprite (text/sprite need an explicit w/h to be hittable). False when hidden/dead.
   */
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

// Draw one retained object through the canvas renderer (TQ-274 makeCanvasRenderer).
function drawObj(r, o) {
  const pos = { x: o.x, y: o.y }, color = o._color, opacity = o._opacity;
  if (o.kind === "circle") r.drawCircle({ pos, radius: o.radius, color, opacity, fill: o.fill !== false, outline: o.outline });
  else if (o.kind === "text") r.drawText({ pos, text: o._text, size: o.size, color, opacity, anchor: o.anchor, font: o.font, width: o.wrap || 0 });
  else if (o.kind === "sprite") r.drawSprite({ pos, sprite: o.sprite, width: o.w, height: o.h, scale: o._scale, angle: o._angle, opacity });
  else r.drawRect({ pos, width: o.w, height: o.h, color, opacity, radius: o.radius, anchor: o.anchor, fill: o.fill !== false, outline: o.outline });
}

/**
 * A retained-object layer: add/remove/destroyAll + a z-ordered render pass. Mirrors the shim's k.add /
 * destroyAll(tag) so a scene's retained menu (buttons/cards) renders on the canvas backend.
 */
export function makeRetainedLayer() {
  let objs = [];
  let hovered = null; // TQ-277: the object currently under the pointer (for hover enter/leave)
  // Topmost interactive object containing the point (highest z, then latest insertion).
  function topAt(x, y) {
    let best = null;
    for (const o of objs) {
      if (o._dead || o._hidden || !o.interactive || !o.contains(x, y)) continue;
      if (!best || o.z > best.z || (o.z === best.z && o.id > best.id)) best = o;
    }
    return best;
  }
  return {
    /** add(rec) -> CanvasObj (the k.add return). */
    add(rec) { const o = new CanvasObj(rec); objs.push(o); return o; },
    remove(o) { const i = objs.indexOf(o); if (i >= 0) { objs[i]._dead = true; objs.splice(i, 1); } },
    /** destroyAll() clears the layer; destroyAll(tag) removes only objects carrying `tag`. */
    destroyAll(tag) {
      if (tag == null) { objs.forEach((o) => { o._dead = true; }); objs = []; return; }
      objs = objs.filter((o) => { if (o.is(tag)) { o._dead = true; return false; } return true; });
    },
    objects() { return objs.slice(); },
    count() { return objs.length; },
    /** Draw every live, non-hidden object in stable z-order (ascending z, then insertion). */
    render(renderer) {
      const live = objs.filter((o) => !o._dead && !o._hidden);
      live.sort((a, b) => (a.z - b.z) || (a.id - b.id));
      for (const o of live) drawObj(renderer, o);
    },
    // ── TQ-277: pointer dispatch (design coords; the screen->design map is Phase 4 input) ──
    /** Topmost interactive object under the point, or null. */
    hitTest(x, y) { return topAt(x, y); },
    /** Fire onClick on the topmost interactive object under the point; returns it (or null). */
    pointerDown(x, y) {
      const o = topAt(x, y);
      if (o) for (const cb of o._on.click) cb(o);
      return o;
    },
    /** Track hover: fire onHoverEnd on the object being left + onHover on the one entered. */
    pointerMove(x, y) {
      const o = topAt(x, y);
      if (o !== hovered) {
        if (hovered && !hovered._dead) for (const cb of hovered._on.hoverEnd) cb(hovered);
        hovered = o;
        if (o) for (const cb of o._on.hover) cb(o);
      }
      return o;
    },
    /** The object currently hovered (for tests / external state). */
    hovered() { return hovered; },
  };
}
