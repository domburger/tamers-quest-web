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

  const k = {
    // ── helpers ──
    rgb: (...c) => (c.length === 1 && Array.isArray(c[0]) ? { r: c[0][0] || 0, g: c[0][1] || 0, b: c[0][2] || 0 } : { r: c[0] || 0, g: c[1] || 0, b: c[2] || 0 }),
    vec2: (x = 0, y = 0) => ({ x, y }),
    width: () => DESIGN_W,
    height: () => DESIGN_H,
    center: () => ({ x: DESIGN_W / 2, y: DESIGN_H / 2 }),
    time: () => _t,
    dt: () => _dt,
    // ── textures ──
    loadSprite: (name, src) => textures.loadSprite(name, src),
    textures, // expose for asset baking (bakeCoreTextures/bakeTile/bakeMonster)
    // ── scene management ──
    scene: (name, fn) => scenes.scene(name, fn),
    go: (name, data) => scenes.go(name, data),
    onSceneLeave: (cb) => scenes.onSceneLeave(cb),
    onUpdate: (cb) => scenes.onUpdate(cb),
    onDraw: (cb) => scenes.onDraw(cb),
    // ── retained objects (flat record for now; comp pipeline is a follow-on) ──
    add: (rec) => retained.add(rec),
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
  };

  // Immediate-mode draws + clip proxy to the live renderer (set each frame); no-op before start().
  for (const m of ["drawRect", "drawCircle", "drawEllipse", "drawLine", "drawText", "drawPolygon", "drawSprite", "pushClip", "popClip"]) {
    k[m] = (o) => { if (renderer) renderer[m](o); };
  }

  /** Boot the runtime: drives the per-frame loop + wires input. Browser only. Returns the runtime. */
  k.start = ({ mount } = {}) => {
    runtime = makeCanvasRuntime((ctx, t, dt) => {
      _t = t; _dt = dt;
      renderer = makeCanvasRenderer(ctx, { textures });
      keyboard.update();                 // continuous onKeyDown handlers
      scenes.update(dt);                 // active scene onUpdate
      scenes.draw(renderer, dt);         // active scene onDraw (immediate world/UI)
      retained.render(renderer);         // retained objects on top (z-sorted; HUD/buttons)
    }, {
      mount,
      onPointer: (kind, x, y) => { if (kind === "down") retained.pointerDown(x, y); else if (kind === "move") retained.pointerMove(x, y); },
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

  // expose the sub-managers for the cutover wiring + harness inspection
  k._scenes = scenes; k._retained = retained;
  return k;
}
