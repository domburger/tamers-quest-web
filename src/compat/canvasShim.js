import { makeCanvasRuntime } from "./canvasBackend.js";
import { makeCanvasRenderer } from "./canvasRenderer.js";
import { makeLabelCache } from "./canvasTextCache.js";
import { makeRetainedLayer } from "./canvasRetained.js";
import { makeSceneManager } from "./canvasScene.js";
import { makeKeyboard } from "./canvasKeyboard.js";
import { makeMouse, isTouchscreen } from "./canvasMouse.js";
import { makeTextureRegistry } from "./canvasTextures.js";
import { makeRefitter, relayoutScenes } from "./canvasRefit.js";

const DESIGN_W = 1280, DESIGN_H = 720;
const NOOP_SUB = { cancel() {} };
// onDraw renders between retained z<0.5 and z>=0.5; scenes rely on it.
const IMMEDIATE_DEPTH = 0.5;

function normColor(...a) {
  if (a.length >= 3) return { r: a[0] || 0, g: a[1] || 0, b: a[2] || 0 };
  const v = a[0];
  if (Array.isArray(v)) return { r: v[0] || 0, g: v[1] || 0, b: v[2] || 0 };
  if (v && typeof v.r === "number") return v;
  return { r: 255, g: 255, b: 255 };
}

const comp = (id, data) => ({ __kcomp: id, ...data });

function compsToRecord(comps) {
  const arr = Array.isArray(comps) ? comps : [comps];
  const by = {};
  for (const c of arr) if (c && c.__kcomp) by[c.__kcomp] = c;
  const rec = { tags: arr.filter((c) => typeof c === "string") };
  if (by.pos) { rec.x = by.pos.x || 0; rec.y = by.pos.y || 0; }
  if (by.anchor) rec.anchor = by.anchor.anchor;
  if (by.color) rec.color = by.color.color;
  if (by.opacity) rec.opacity = by.opacity.opacity;
  if (by.scale) rec.scale = by.scale.scale;
  if (by.z) rec.z = by.z.z;
  if (by.outline) rec.outline = { width: by.outline.width, color: by.outline.color };
  if (by.fixed) rec.fixed = true;
  if (by.rect) { rec.kind = "rect"; rec.w = by.rect.w; rec.h = by.rect.h; rec.radius = by.rect.radius || 0; rec.gradient = by.rect.gradient || null; rec.shadow = by.rect.shadow || null; if (by.rect.fill === false) rec.fill = false; }
  else if (by.circle) { rec.kind = "circle"; rec.radius = by.circle.r; if (by.circle.fill === false) rec.fill = false; }
  else if (by.text) { rec.kind = "text"; rec.text = by.text.text; if (by.text.size) rec.size = by.text.size; if (by.text.font) rec.font = by.text.font; if (by.text.width) rec.wrap = by.text.width; }
  else if (by.sprite) { rec.kind = "sprite"; rec.sprite = by.sprite.name; }
  return rec;
}

export function makeCanvasShim() {
  const textures = makeTextureRegistry();
  const scenes = makeSceneManager();
  const retained = makeRetainedLayer();
  const labelCache = makeLabelCache();
  // Create eagerly: scene setup registers key handlers before start().
  const keyboard = makeKeyboard();
  let mouse = null, runtime = null, refitter = null, renderer = null;
  let _t = 0, _dt = 0;
  let sceneFadeP = -1;
  const SCENE_FADE_S = 0.3;
  let _w2sRect = null, _w2sRectT = -1;

  const liveWidth = () => (runtime && runtime.canvas && runtime.canvas._tq && runtime.canvas._tq.vp ? runtime.canvas._tq.vp.W : DESIGN_W);

  let camTarget = null;
  const camOffset = () => (camTarget ? { dx: liveWidth() / 2 - camTarget.x, dy: DESIGN_H / 2 - camTarget.y } : { dx: 0, dy: 0 });
  const applyCam = (o = {}) => {
    if (o.fixed) return o;
    const { dx, dy } = camOffset();
    if (!dx && !dy) return o;
    const c = { ...o };
    if (o.pos) c.pos = { x: (o.pos.x || 0) + dx, y: (o.pos.y || 0) + dy };
    if (o.p1) c.p1 = { x: (o.p1.x || 0) + dx, y: (o.p1.y || 0) + dy };
    if (o.p2) c.p2 = { x: (o.p2.x || 0) + dx, y: (o.p2.y || 0) + dy };
    if (Array.isArray(o.pts)) c.pts = o.pts.map((p) => ({ x: (p.x || 0) + dx, y: (p.y || 0) + dy }));
    return c;
  };

  let timers = [];
  const tickTimers = (dt) => {
    let anyDead = false;
    for (const t of timers) {
      if (t.dead) { anyDead = true; continue; }
      t.remaining -= dt;
      if (t.remaining <= 0) { t.dead = true; anyDead = true; try { t.cb(); } catch (e) { void e; } }
    }
    if (anyDead) timers = timers.filter((t) => !t.dead);
  };

  const k = {
    rgb: (...c) => normColor(...c),
    vec2: (x = 0, y = 0) => ({ x, y }),
    rect: (w, h, o = {}) => comp("rect", { w, h, radius: o.radius || 0, gradient: o.gradient || null, shadow: o.shadow || null, fill: o.fill }),
    circle: (r, o = {}) => comp("circle", { r, fill: o.fill }),
    text: (t, o = {}) => comp("text", { text: t, size: o.size, font: o.font, width: o.width, align: o.align }),
    sprite: (name) => comp("sprite", { name }),
    pos: (x, y) => comp("pos", { x, y }),
    anchor: (a) => comp("anchor", { anchor: a }),
    color: (...a) => comp("color", { color: normColor(...a) }),
    outline: (w, c) => comp("outline", { width: w, color: normColor(c) }),
    opacity: (o) => comp("opacity", { opacity: o }),
    scale: (s) => comp("scale", { scale: s }),
    z: (z) => comp("z", { z }),
    fixed: () => comp("fixed", {}),
    area: () => comp("area", {}),
    width: () => liveWidth(),
    height: () => DESIGN_H,
    center: () => ({ x: liveWidth() / 2, y: DESIGN_H / 2 }),
    time: () => _t,
    dt: () => _dt,
    wait: (sec, cb) => { const t = { remaining: Math.max(0, sec || 0), cb, dead: false }; timers.push(t); return { cancel() { t.dead = true; } }; },
    loadSprite: (name, src) => textures.loadSprite(name, src),
    loadFont: (name, url) => {
      if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) return Promise.resolve();
      try { return new FontFace(name, `url(${url})`).load().then((f) => { document.fonts.add(f); return f; }).catch(() => {}); }
      catch (e) { void e; return Promise.resolve(); }
    },
    textures,
    scene: (name, fn) => scenes.scene(name, fn),
    // Clear scene-scoped state before scenes.go runs the next setup.
    go: (name, data) => { timers = []; retained.destroyAll(); camTarget = null; if (keyboard) keyboard.clearHandlers(); sceneFadeP = 0; return scenes.go(name, data); },
    onSceneLeave: (cb) => scenes.onSceneLeave(cb),
    onUpdate: (cb) => scenes.onUpdate(cb),
    onDraw: (cb) => scenes.onDraw(cb),
    add: (comps) => retained.add(Array.isArray(comps) ? compsToRecord(comps) : comps),
    destroyAll: (tag) => retained.destroyAll(tag),
    isKeyDown: (n) => (keyboard ? keyboard.isKeyDown(n) : false),
    onKeyPress: (n, cb) => (keyboard ? keyboard.onKeyPress(n, cb) : NOOP_SUB),
    onKeyDown: (n, cb) => (keyboard ? keyboard.onKeyDown(n, cb) : NOOP_SUB),
    onCharInput: (cb) => (keyboard ? keyboard.onCharInput(cb) : NOOP_SUB),
    mousePos: () => (mouse ? mouse.mousePos() : { x: 0, y: 0 }),
    onMousePress: (cb) => (mouse ? mouse.onMousePress(cb) : NOOP_SUB),
    onMouseMove: (cb) => (mouse ? mouse.onMouseMove(cb) : NOOP_SUB),
    onMouseRelease: (cb) => (mouse ? mouse.onMouseRelease(cb) : NOOP_SUB),
    onScroll: (cb) => (mouse ? mouse.onScroll(cb) : NOOP_SUB),
    onTouchStart: (cb) => (mouse ? mouse.onTouchStart(cb) : NOOP_SUB),
    onTouchMove: (cb) => (mouse ? mouse.onTouchMove(cb) : NOOP_SUB),
    onTouchEnd: (cb) => (mouse ? mouse.onTouchEnd(cb) : NOOP_SUB),
    isTouchscreen,
    setCursor: (s) => { if (mouse) mouse.setCursor(s); },
    camPos: (x, y) => { camTarget = { x: typeof x === "number" ? x : (camTarget ? camTarget.x : liveWidth() / 2), y: typeof y === "number" ? y : (camTarget ? camTarget.y : DESIGN_H / 2) }; },
    getCamPos: () => (camTarget ? { x: camTarget.x, y: camTarget.y } : { x: liveWidth() / 2, y: DESIGN_H / 2 }),
    worldToScreen: (x, y, { fixed = false } = {}) => {
      if (!runtime || !runtime.canvas || !runtime.canvas.getBoundingClientRect) return null;
      let rect = _w2sRect;
      if (_w2sRectT !== _t || !rect) { rect = runtime.canvas.getBoundingClientRect(); _w2sRect = rect; _w2sRectT = _t; }
      const scale = (rect.height || DESIGN_H) / DESIGN_H;
      const { dx, dy } = fixed ? { dx: 0, dy: 0 } : camOffset();
      return { x: rect.left + (x + dx) * scale, y: rect.top + (y + dy) * scale, scale };
    },
  };

  for (const m of ["drawRect", "drawCircle", "drawEllipse", "drawLine", "drawText", "drawPolygon", "drawSprite"]) {
    k[m] = (o) => { if (renderer) renderer[m](applyCam(o)); };
  }
  k.pushClip = (x, y, w, h) => { if (renderer) renderer.pushClip(x, y, w, h); };
  k.popClip = () => { if (renderer) renderer.popClip(); };
  let frostWanted = false, frostUsed = false;
  k.requestFrost = () => { frostWanted = true; };
  k.frostReady = () => !!(runtime && runtime.frost && runtime.frost.ready);
  k.drawFrost = (o) => { const ok = renderer && renderer.drawFrost ? renderer.drawFrost({ ...o, fixed: true }) : false; if (ok) frostUsed = true; return ok; };
  k.measureText = (text, size, font) => (renderer && renderer.measureText ? renderer.measureText(text, size, font) : String(text || "").length * (size || 16) * 0.56);

  k.start = ({ mount, hideTitle, zIndex } = {}) => {
    runtime = makeCanvasRuntime((ctx, t, dt) => {
      _t = t; _dt = dt;
      renderer = makeCanvasRenderer(ctx, { textures, labelCache, frost: runtime ? runtime.frost : null, designW: k.width(), designH: k.height() });
      keyboard.update();
      tickTimers(dt);
      scenes.update(dt);
      const cam = camOffset();
      retained.render(renderer, cam, { below: IMMEDIATE_DEPTH });
      scenes.draw(renderer, dt);
      retained.render(renderer, cam, { from: IMMEDIATE_DEPTH });
      if (sceneFadeP >= 0) {
        const f = Math.min(1, sceneFadeP), op = (1 - f) * (1 - f);
        if (op > 0.01) renderer.drawRect({ pos: { x: 0, y: 0 }, width: k.width(), height: k.height(), color: { r: 0, g: 0, b: 0 }, opacity: op, fixed: true });
        sceneFadeP += Math.min(dt || 0.016, 1 / 30) / SCENE_FADE_S;
        if (sceneFadeP >= 1) sceneFadeP = -1;
      }
      if (!frostUsed && runtime && runtime.frost) runtime.frost.ready = false;
      frostUsed = false;
      if (frostWanted) { frostWanted = false; if (runtime && runtime.captureFrost) runtime.captureFrost(); }
    }, {
      mount,
      onPointer: (kind, x, y) => { if (kind === "down") retained.pointerDown(x, y); else if (kind === "move") retained.pointerMove(x, y); },
      hideTitle, zIndex,
    });
    mouse = makeMouse(runtime.canvas);
    // Must clear like k.go does, or the re-run scene draws over the old one.
    refitter = makeRefitter({ onRefit: () => {
      // Resize first so the relayout reads the settled post-rotation size.
      try { runtime.resize(); } catch (e) { void e; }
      return relayoutScenes({
        current: () => scenes.current(),
        lastGo: () => scenes.lastGo(),
        go: (name, data) => { timers = []; retained.destroyAll(); camTarget = null; if (keyboard) keyboard.clearHandlers(); return scenes.go(name, data); },
      });
    } });
    return runtime;
  };

  k.stop = () => {
    try { refitter && refitter.dispose(); } catch (e) { void e; }
    try { mouse && mouse.dispose(); } catch (e) { void e; }
    try { keyboard && keyboard.dispose(); } catch (e) { void e; }
    try { runtime && runtime.stop(); } catch (e) { void e; }
    scenes.stop();
  };

  k._scenes = scenes; k._retained = retained; k._tickTimers = tickTimers;
  return k;
}
