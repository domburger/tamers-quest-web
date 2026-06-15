// TQ-287 (Phase 6, engine-removal TQ-227/233): assemble the Phase 2-5 canvas modules into a single k.*
// object — the cutover target. ADDITIVE: this composes the standalone modules into one runtime; it does
// NOT touch the live Phaser path (src/main.js + src/compat/kaboomShim.js). Booting a real scene against
// this `k` is the "render harness" that surfaces the remaining k.* gaps before the flag-flip / Phaser
// removal (later TQ-233 leaves). No Phaser import.
//
// WHAT'S COVERED: immediate draws (rect/circle/ellipse/line/text/polygon/sprite + pushClip/popClip),
//   retained add/destroyAll (FLAT records — the full KObj component pipeline of k.add(k.pos(),k.rect(),…)
//   is a follow-on leaf), scene mgmt (scene/go/onUpdate/onDraw/onSceneLeave), input (keyboard + mouse +
//   touch), textures (loadSprite), and the rgb/vec2/width/height/center/time/dt helpers + responsive refit.
// WHAT'S NOT YET: the k.add comp pipeline, k.wait/tween/loop, audio, k.loadFont (FontFace — trivial, keep),
//   and the long tail of scene helpers — tracked on TQ-233.
import { makeCanvasRuntime } from "./canvasBackend.js";
import { makeCanvasRenderer } from "./canvasRenderer.js";
import { makeRetainedLayer } from "./canvasRetained.js";
import { makeSceneManager } from "./canvasScene.js";
import { makeKeyboard } from "./canvasKeyboard.js";
import { makeMouse, isTouchscreen } from "./canvasMouse.js";
import { makeTextureRegistry } from "./canvasTextures.js";
import { makeRefitter, relayoutScenes } from "./canvasRefit.js";

const DESIGN_W = 1280, DESIGN_H = 720;
const NOOP_SUB = { cancel() {} };
// Phaser parity (kaboomShim.js IMMEDIATE_DEPTH): immediate-mode onDraw content sits at depth 0.5 —
// ABOVE default-z (0) retained objects (k.add backgrounds/cards/buttons) but BELOW z>=1 retained
// overlays. Scenes rely on this (e.g. character-select composites tamer portraits in onDraw OVER the
// retained menu background + cards). So retained must render in two bands AROUND the onDraw layer, not
// all-on-top — else the menu background covers every onDraw figure (the canvas char-select breakage).
const IMMEDIATE_DEPTH = 0.5;

// Normalize a color from any of: (r,g,b) | [r,g,b] | a {r,g,b}/KColor object → {r,g,b}. Default white.
function normColor(...a) {
  if (a.length >= 3) return { r: a[0] || 0, g: a[1] || 0, b: a[2] || 0 };
  const v = a[0];
  if (Array.isArray(v)) return { r: v[0] || 0, g: v[1] || 0, b: v[2] || 0 };
  if (v && typeof v.r === "number") return v;
  return { r: 255, g: 255, b: 255 };
}

// TQ-288: a comp descriptor (mirrors the shim's comp()). k.add() reads these to build a CanvasObj.
const comp = (id, data) => ({ __kcomp: id, ...data });

// Translate a k.add comp list (descriptors + string tags) into the flat CanvasObj record.
function compsToRecord(comps) {
  const arr = Array.isArray(comps) ? comps : [comps];
  const by = {};
  for (const c of arr) if (c && c.__kcomp) by[c.__kcomp] = c;
  const rec = { tags: arr.filter((c) => typeof c === "string") };
  if (by.pos) { rec.x = by.pos.x || 0; rec.y = by.pos.y || 0; }
  if (by.anchor) rec.anchor = by.anchor.anchor;
  if (by.color) rec.color = by.color.color;                 // {r,g,b}; CanvasObj.toRGB normalizes
  if (by.opacity) rec.opacity = by.opacity.opacity;
  if (by.scale) rec.scale = by.scale.scale;
  if (by.z) rec.z = by.z.z;
  if (by.outline) rec.outline = { width: by.outline.width, color: by.outline.color };
  if (by.fixed) rec.fixed = true;                           // TQ-290: screen-anchored (skips camera)
  if (by.rect) { rec.kind = "rect"; rec.w = by.rect.w; rec.h = by.rect.h; rec.radius = by.rect.radius || 0; }
  else if (by.circle) { rec.kind = "circle"; rec.radius = by.circle.r; }
  else if (by.text) { rec.kind = "text"; rec.text = by.text.text; if (by.text.size) rec.size = by.text.size; if (by.text.font) rec.font = by.text.font; if (by.text.width) rec.wrap = by.text.width; }
  else if (by.sprite) { rec.kind = "sprite"; rec.sprite = by.sprite.name; }
  return rec;
}

/**
 * Compose the canvas backend into a k.* object. Pure construction (no DOM) until start() is called.
 * @returns {object} the k shim
 */
export function makeCanvasShim() {
  const textures = makeTextureRegistry();
  const scenes = makeSceneManager();
  const retained = makeRetainedLayer();
  // Keyboard is created EAGERLY (it only needs window, available now) so onKeyPress/onKeyDown registered
  // during scene setup — which runs on go(), before start() — aren't dropped. (Harness finding, TQ-287.)
  const keyboard = makeKeyboard();
  let mouse = null, runtime = null, refitter = null, renderer = null;
  let _t = 0, _dt = 0;
  // TQ-262 perf: per-frame cache of the canvas bounding rect for worldToScreen. The HTML monster
  // overlay calls worldToScreen once per visible monster per frame, AFTER writing mount.style.clipPath
  // (which dirties layout) — so each getBoundingClientRect would force a fresh layout recalc (thrash).
  // The rect is constant within a rendered frame, so memoize it keyed on the frame time _t.
  let _w2sRect = null, _w2sRectT = -1;

  // TQ-294: the live aspect-matched design width (k.width), read from the runtime; DESIGN_W before start.
  const liveWidth = () => (runtime && runtime.canvas && runtime.canvas._tq && runtime.canvas._tq.vp ? runtime.canvas._tq.vp.W : DESIGN_W);

  // TQ-290/294: camera. camTarget is the world point centred on screen; null = NEUTRAL (no scroll, offset 0)
  // regardless of the live width. camPos(x,y) sets it. The offset centres on the LIVE width (W/2), not a
  // fixed 1280/2, so scrolling is correct on any aspect; fixed draws skip the offset.
  let camTarget = null;
  const camOffset = () => (camTarget ? { dx: liveWidth() / 2 - camTarget.x, dy: DESIGN_H / 2 - camTarget.y } : { dx: 0, dy: 0 });
  // Shallow-copy a draw opts object with its positional fields shifted by (dx,dy) — unless o.fixed.
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

  // TQ-289: frame-driven, scene-scoped timers (k.wait). Game-time (ticked by the loop with dt), so they
  // pause with the loop like Phaser's delayedCall. Cleared on go() so a wait can't outlive its scene.
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
    // ── helpers ──
    rgb: (...c) => normColor(...c),
    vec2: (x = 0, y = 0) => ({ x, y }),
    // ── TQ-288: component constructors (k.add reads these descriptors) ──
    rect: (w, h, o = {}) => comp("rect", { w, h, radius: o.radius || 0 }),
    circle: (r) => comp("circle", { r }),
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
    width: () => liveWidth(),         // TQ-294: dynamic, aspect-matched
    height: () => DESIGN_H,
    center: () => ({ x: liveWidth() / 2, y: DESIGN_H / 2 }),
    time: () => _t,
    dt: () => _dt,
    // TQ-289: k.wait(sec, cb) — fires cb after `sec` game-seconds; cancelable; scene-scoped (cleared on go).
    wait: (sec, cb) => { const t = { remaining: Math.max(0, sec || 0), cb, dead: false }; timers.push(t); return { cancel() { t.dead = true; } }; },
    // ── assets ──
    loadSprite: (name, src) => textures.loadSprite(name, src),
    // TQ-289: k.loadFont(name, url) — DOM FontFace (port of kaboomShim.js:450). No-op without a DOM.
    loadFont: (name, url) => {
      if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) return Promise.resolve();
      try { return new FontFace(name, `url(${url})`).load().then((f) => { document.fonts.add(f); return f; }).catch(() => {}); }
      catch (e) { void e; return Promise.resolve(); }
    },
    textures, // expose for asset baking (bakeCoreTextures/bakeTile/bakeMonster)
    // ── scene management ──
    scene: (name, fn) => scenes.scene(name, fn),
    // TQ-289: drop the old scene's pending waits. TQ-233: also CLEAR all retained objects + RESET the camera
    // — k.add objects are scene-scoped (Phaser destroys the scene's display list on switch) AND each Phaser
    // scene starts with a fresh camera at scroll 0. Without the clear, every scene's background/cards/buttons
    // leak into the next (settings drew ON TOP of a still-present character-select); without the camera reset,
    // a stale scroll from a world scene (e.g. the hub follows the player via camPos) shifts the next scene's
    // world-space UI off-screen (settings rendered BLANK after the hub). Both run BEFORE scenes.go executes
    // the next scene's setup (which re-adds that scene's retained objects + re-establishes any camera).
    go: (name, data) => { timers = []; retained.destroyAll(); camTarget = null; return scenes.go(name, data); },
    onSceneLeave: (cb) => scenes.onSceneLeave(cb),
    onUpdate: (cb) => scenes.onUpdate(cb),
    onDraw: (cb) => scenes.onDraw(cb),
    // ── retained objects: k.add(comp list) — real scene usage — or a plain flat record (harness) ──
    add: (comps) => retained.add(Array.isArray(comps) ? compsToRecord(comps) : comps),
    destroyAll: (tag) => retained.destroyAll(tag),
    // ── input: keyboard ──
    isKeyDown: (n) => (keyboard ? keyboard.isKeyDown(n) : false),
    onKeyPress: (n, cb) => (keyboard ? keyboard.onKeyPress(n, cb) : NOOP_SUB),
    onKeyDown: (n, cb) => (keyboard ? keyboard.onKeyDown(n, cb) : NOOP_SUB),
    onCharInput: (cb) => (keyboard ? keyboard.onCharInput(cb) : NOOP_SUB),
    // ── input: mouse / touch ──
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
    // ── TQ-290/294: camera ──
    camPos: (x, y) => { camTarget = { x: typeof x === "number" ? x : (camTarget ? camTarget.x : liveWidth() / 2), y: typeof y === "number" ? y : (camTarget ? camTarget.y : DESIGN_H / 2) }; },
    getCamPos: () => (camTarget ? { x: camTarget.x, y: camTarget.y } : { x: liveWidth() / 2, y: DESIGN_H / 2 }),
    // Map a design point to PAGE CSS px (camera offset for world + aspect-match scale + canvas page offset)
    // for the DOM monster overlay (TQ-262). Aspect-match fill → no letterbox offset. Null before start().
    worldToScreen: (x, y, { fixed = false } = {}) => {
      if (!runtime || !runtime.canvas || !runtime.canvas.getBoundingClientRect) return null;
      // Reuse the rect within a frame (see _w2sRect note) — avoids a forced reflow per overlay monster.
      let rect = _w2sRect;
      if (_w2sRectT !== _t || !rect) { rect = runtime.canvas.getBoundingClientRect(); _w2sRect = rect; _w2sRectT = _t; }
      const scale = (rect.height || DESIGN_H) / DESIGN_H;
      const { dx, dy } = fixed ? { dx: 0, dy: 0 } : camOffset();
      return { x: rect.left + (x + dx) * scale, y: rect.top + (y + dy) * scale, scale };
    },
  };

  // Immediate-mode draws: WORLD draws shift by the camera (applyCam); o.fixed skips it. No-op before start().
  for (const m of ["drawRect", "drawCircle", "drawEllipse", "drawLine", "drawText", "drawPolygon", "drawSprite"]) {
    k[m] = (o) => { if (renderer) renderer[m](applyCam(o)); };
  }
  // Clip is screen-space (UI: station popups / scrolling grids) — no camera shift.
  k.pushClip = (x, y, w, h) => { if (renderer) renderer.pushClip(x, y, w, h); };
  k.popClip = () => { if (renderer) renderer.popClip(); };

  /** Boot the runtime: drives the per-frame loop + wires input. Browser only. Returns the runtime. */
  k.start = ({ mount, hideTitle, zIndex } = {}) => {
    runtime = makeCanvasRuntime((ctx, t, dt) => {
      _t = t; _dt = dt;
      renderer = makeCanvasRenderer(ctx, { textures });
      keyboard.update();                 // continuous onKeyDown handlers
      tickTimers(dt);                    // TQ-289: k.wait timers (game-time)
      scenes.update(dt);                 // active scene onUpdate
      // Z-banded compositing to match the Phaser shim: retained z<0.5 (backgrounds/cards/buttons at the
      // default z=0) UNDER the onDraw layer, then onDraw (immediate world/UI at depth 0.5), then retained
      // z>=0.5 (explicit-z overlays/popups) ON TOP. World draws camera-shifted via applyCam/camOffset.
      const cam = camOffset();
      retained.render(renderer, cam, { below: IMMEDIATE_DEPTH }); // backdrop + default-z UI, behind onDraw
      scenes.draw(renderer, dt);                                  // active scene onDraw (immediate, depth 0.5)
      retained.render(renderer, cam, { from: IMMEDIATE_DEPTH });  // z>=1 overlays/popups, above onDraw
    }, {
      mount,
      onPointer: (kind, x, y) => { if (kind === "down") retained.pointerDown(x, y); else if (kind === "move") retained.pointerMove(x, y); },
      hideTitle, zIndex,
    });
    mouse = makeMouse(runtime.canvas);
    refitter = makeRefitter({ onRefit: () => relayoutScenes(scenes) });
    return runtime;
  };

  /** Tear down: dispose input + refit + runtime + active scene. */
  k.stop = () => {
    try { refitter && refitter.dispose(); } catch (e) { void e; }
    try { mouse && mouse.dispose(); } catch (e) { void e; }
    try { keyboard && keyboard.dispose(); } catch (e) { void e; }
    try { runtime && runtime.stop(); } catch (e) { void e; }
    scenes.stop();
  };

  // expose the sub-managers + the timer tick for the cutover wiring + harness inspection / tests
  k._scenes = scenes; k._retained = retained; k._tickTimers = tickTimers;
  return k;
}
