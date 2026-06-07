// ─────────────────────────────────────────────────────────────────────────────
// Kaboom → Phaser compatibility shim
//
// The game was written against Kaboom.js (abandoned by Replit in June 2024). The
// project migrated to Phaser 3 (see docs/IMPLEMENTATION_PLAN.md). Rather than
// rewrite all 14 scenes + 3 render modules at once, this module exposes the exact
// `k.*` API surface the codebase uses, backed by a Phaser.Game. Scenes keep
// calling `k.*`; those calls now drive Phaser. This preserves every line of the
// tested game logic and the immediate-mode rendering style.
//
// Design notes:
//  - Immediate-mode draws (`onDraw` → drawRect/drawCircle/...) are replayed each
//    frame into POOLED Phaser objects: contiguous shape runs batch into one
//    Graphics; drawText/drawSprite use pooled Text/Image. Pool objects are reused
//    frame-to-frame and hidden when unused.
//  - Z-order matches Kaboom: immediate content sits at depth band ~0.5; retained
//    objects (k.add) sit at depth = their z (default 0), so a z=-10 backdrop is
//    behind immediate draws and a z=100 HUD is above them.
//  - This is a faithful adapter, not idiomatic Phaser. Hot scenes can be
//    refactored to native Sprites/tweens later (documented follow-up).
// ─────────────────────────────────────────────────────────────────────────────

import Phaser from "phaser";

const DPR = Math.min(3, Math.max(1, Math.ceil(window.devicePixelRatio || 1)));
const IMMEDIATE_DEPTH = 0.5; // band for onDraw content (between z=0 and z=1 objects)

// ── Color ────────────────────────────────────────────────────────────────────
const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));
class KColor {
  constructor(r, g, b) { this.r = clamp255(r); this.g = clamp255(g); this.b = clamp255(b); }
  lighten(n) { return new KColor(this.r + n, this.g + n, this.b + n); }
  darken(n) { return new KColor(this.r - n, this.g - n, this.b - n); }
  toInt() { return (this.r << 16) | (this.g << 8) | this.b; }
  toCSS() { return "#" + this.toInt().toString(16).padStart(6, "0"); }
}
KColor.fromHex = (h) => {
  const s = String(h).replace("#", "");
  const n = parseInt(s, 16);
  return new KColor((n >> 16) & 255, (n >> 8) & 255, n & 255);
};
// Accept (r,g,b), ([r,g,b]) or (KColor) and return a KColor.
function toColor(...args) {
  if (args.length === 1) {
    const a = args[0];
    if (a instanceof KColor) return a;
    if (Array.isArray(a)) return new KColor(a[0], a[1], a[2]);
    if (typeof a === "number") return new KColor(a, a, a);
  }
  return new KColor(args[0] ?? 0, args[1] ?? 0, args[2] ?? 0);
}
const colorInt = (c) => (c instanceof KColor ? c.toInt() : toColor(c).toInt());

// ── Vec2 (Kaboom method names: add/sub/scale/len) ──────────────────────────────
class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  add(v) { return new Vec2(this.x + v.x, this.y + v.y); }
  sub(v) { return new Vec2(this.x - v.x, this.y - v.y); }
  scale(s) { return new Vec2(this.x * (s.x ?? s), this.y * (s.y ?? s)); }
  len() { return Math.hypot(this.x, this.y); }
  dist(v) { return Math.hypot(this.x - v.x, this.y - v.y); }
  unit() { const l = this.len() || 1; return new Vec2(this.x / l, this.y / l); }
  clone() { return new Vec2(this.x, this.y); }
}

// ── Anchor → Phaser origin ─────────────────────────────────────────────────────
const ANCHORS = {
  topleft: [0, 0], top: [0.5, 0], topright: [1, 0],
  left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
  botleft: [0, 1], bottomleft: [0, 1], bot: [0.5, 1], bottom: [0.5, 1],
  botright: [1, 1], bottomright: [1, 1],
};
const originOf = (anchor) => ANCHORS[anchor] || ANCHORS.topleft;

// ── Phaser keycode mapping ─────────────────────────────────────────────────────
const KC = Phaser.Input.Keyboard.KeyCodes;
const KEYMAP = {
  up: KC.UP, down: KC.DOWN, left: KC.LEFT, right: KC.RIGHT,
  space: KC.SPACE, enter: KC.ENTER, escape: KC.ESC, esc: KC.ESC,
  backspace: KC.BACKSPACE, tab: KC.TAB, shift: KC.SHIFT,
  "[": KC.OPEN_BRACKET, "]": KC.CLOSED_BRACKET,
};
function keyCode(name) {
  const n = String(name).toLowerCase();
  if (KEYMAP[n] != null) return KEYMAP[n];
  if (n.length === 1 && n >= "a" && n <= "z") return KC[n.toUpperCase()];
  if (n.length === 1 && n >= "0" && n <= "9") return KC["DIGIT_" + n] ?? KC["NUMPAD_" + n] ?? n.charCodeAt(0);
  return null;
}

// ── Component descriptors (returned by k.rect/k.pos/... consumed by k.add) ──────
const comp = (id, data) => ({ __kcomp: id, ...data });

// ── Retained object wrapper (return value of k.add) ────────────────────────────
class KObj {
  constructor(scene, go, kind) {
    this._scene = scene; this.go = go; this._kind = kind;
    this._baseColor = null; this._anchor = "topleft";
    this._w = 0; this._h = 0; this.tags = [];
  }
  // position
  get pos() { return new Vec2(this.go.x, this.go.y); }
  set pos(v) { this.go.setPosition(v.x, v.y); }
  // size (HP/energy bars resize .width each frame)
  get width() { return this.go.displayWidth; }
  set width(w) { this.go.displayWidth = w; }
  get height() { return this.go.displayHeight; }
  set height(h) { this.go.displayHeight = h; }
  // color
  get color() { return this._baseColor; }
  set color(c) {
    this._baseColor = c instanceof KColor ? c : toColor(c);
    const i = this._baseColor.toInt();
    if (this._kind === "text") this.go.setColor(this._baseColor.toCSS());
    else if (this.go.setFillStyle) this.go.setFillStyle(i, this.go.alpha ?? 1);
    else if (this.go.setTint) this.go.setTint(i);
  }
  get opacity() { return this.go.alpha; }
  set opacity(o) { this.go.setAlpha(o); }
  get text() { return this.go.text; }
  set text(t) { if (this.go.setText) this.go.setText(t == null ? "" : String(t)); }
  get hidden() { return !this.go.visible; }
  set hidden(v) { this.go.setVisible(!v); }
  get scale() { return this.go.scaleX; }
  set scale(s) { this.go.setScale(s); }
  get angle() { return this.go.angle; }
  set angle(a) { this.go.setAngle(a); }
  // events
  _interactive() { if (!this.go.input) this.go.setInteractive(); }
  onClick(cb) { this._interactive(); this.go.on("pointerdown", cb); return this; }
  onHover(cb) { this._interactive(); this.go.on("pointerover", cb); return this; }
  onHoverUpdate(cb) { this._interactive(); this.go.on("pointerover", cb); this.go.on("pointermove", cb); return this; }
  onHoverEnd(cb) { this._interactive(); this.go.on("pointerout", cb); return this; }
  destroy() { this.go.destroy(); }
}

// ── Generic Phaser scene that runs a registered Kaboom scene fn ─────────────────
class KScene extends Phaser.Scene {
  constructor(key, fn, k) { super(key); this._fn = fn; this._k = k; }

  create(data) {
    this._k._active = this;
    this._updates = [];
    this._draws = [];
    this._keyDownConts = []; // {name, cb} for onKeyDown (continuous)
    this._leaveCbs = [];
    this._disposables = []; // DOM listeners to remove on shutdown
    this._tagged = new Map(); // tag -> Set<KObj>
    this._insert = 0;
    this._keys = new Map();
    // pools for immediate-mode rendering
    this._gfxPool = []; this._txtPool = []; this._imgPool = [];
    this._dt = 0;

    this.events.once("shutdown", () => this._shutdown());

    // flush any pre-boot adds (the top-level "Loading..." text)
    if (this._k._preBootAdds && this._k._preBootAdds.length) {
      const buf = this._k._preBootAdds; this._k._preBootAdds = [];
      for (const comps of buf) this._k.add(comps);
    }
    this._fn(data || {});
  }

  update(_t, deltaMs) {
    this._dt = Math.min(0.05, deltaMs / 1000); // clamp big spikes
    for (const { name, cb } of this._keyDownConts) {
      const key = this._getKey(name);
      if (key && key.isDown) cb();
    }
    for (const cb of this._updates.slice()) cb();
    this._renderImmediate();
  }

  _renderImmediate() {
    this._seq = 0; this._curGfx = null; this._curFixed = false;
    this._gfxCursor = 0; this._txtCursor = 0; this._imgCursor = 0;
    for (const cb of this._draws.slice()) cb();
    // hide unused pooled objects
    for (let i = this._gfxCursor; i < this._gfxPool.length; i++) this._gfxPool[i].setVisible(false);
    for (let i = this._txtCursor; i < this._txtPool.length; i++) this._txtPool[i].setVisible(false);
    for (let i = this._imgCursor; i < this._imgPool.length; i++) this._imgPool[i].setVisible(false);
  }

  _nextDepth() { return IMMEDIATE_DEPTH + this._seq++ * 1e-6; }

  _ensureGfx(fixed) {
    if (this._curGfx && this._curFixed === fixed) return this._curGfx;
    let g = this._gfxPool[this._gfxCursor];
    if (!g) { g = this.add.graphics(); this._gfxPool.push(g); }
    this._gfxCursor++;
    g.clear(); g.setVisible(true);
    g.setScrollFactor(fixed ? 0 : 1);
    g.setDepth(this._nextDepth());
    this._curGfx = g; this._curFixed = fixed;
    return g;
  }
  _sealGfx() { this._curGfx = null; }

  _ensureText(fixed) {
    this._sealGfx();
    let t = this._txtPool[this._txtCursor];
    if (!t) { t = this.add.text(0, 0, "", {}); t.setResolution(1); this._txtPool.push(t); }
    this._txtCursor++;
    t.setVisible(true).setScrollFactor(fixed ? 0 : 1).setDepth(this._nextDepth());
    return t;
  }
  _ensureImg(fixed, key) {
    this._sealGfx();
    let im = this._imgPool[this._imgCursor];
    if (!im) { im = this.add.image(0, 0, key); this._imgPool.push(im); }
    else im.setTexture(key);
    this._imgCursor++;
    im.setVisible(true).setScrollFactor(fixed ? 0 : 1).setDepth(this._nextDepth())
      .setScale(1).setRotation(0).clearTint?.();
    return im;
  }

  _getKey(name) {
    let key = this._keys.get(name);
    if (!key) {
      const code = keyCode(name);
      if (code == null) return null;
      key = this.input.keyboard.addKey(code, true, false);
      this._keys.set(name, key);
    }
    return key;
  }

  _track(obj, tags) {
    for (const t of tags) {
      if (!this._tagged.has(t)) this._tagged.set(t, new Set());
      this._tagged.get(t).add(obj);
    }
  }

  _shutdown() {
    for (const d of this._disposables) { try { d(); } catch {} }
    for (const cb of this._leaveCbs) { try { cb(); } catch {} }
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────
export default function kaboom(opts = {}) {
  const H = opts.height || 720; // fixed design HEIGHT — vertical layouts stay stable
  // Responsive design WIDTH: match the window's aspect ratio so the FIT-scaled
  // canvas fills the screen with NO letterbox bars on any aspect (4:3 → ultrawide),
  // exactly like the pure-HTML title screen. Scenes lay out relative to
  // k.width()/k.height(), so a flexible width simply gives them more/less
  // horizontal room. Clamped to a sane landscape range (portrait phones are gated
  // by the HTML rotate-notice, so we never need a portrait canvas). opts.width is
  // ignored on purpose — the old fixed 1280 is what caused the letterbox.
  const designW = () => {
    const ww = (typeof window !== "undefined" && window.innerWidth) || 1280;
    const wh = (typeof window !== "undefined" && window.innerHeight) || 720;
    return Math.max(960, Math.min(2560, Math.round(H * (ww / wh))));
  };
  let W = designW();
  // Render scale for crispness: the canvas backing buffer should match the physical
  // on-screen pixels, not the design size. FIT scales the canvas by
  // min(winW/W, winH/H); multiplying by that × devicePixelRatio makes the backing
  // buffer ≈ native resolution, so FIT maps ~1:1 instead of upscaling (which blurred
  // the game on 4K — esp. at 100% OS scaling where devicePixelRatio is 1). World
  // coords stay W×H (zoom changes resolution, not coordinates). Capped for perf.
  const winW = (typeof window !== "undefined" && window.innerWidth) || W;
  const winH = (typeof window !== "undefined" && window.innerHeight) || H;
  const RENDER_SCALE = Math.min(4, Math.max(1, Math.min(winW / W, winH / H) * DPR));
  const bg = toColor(...(opts.background || [0, 0, 0]));

  const k = {
    _active: null,
    _ready: false,
    _pendingGo: null,
    _preBootAdds: [],
    _fontPromises: [],
    _sceneFns: new Map(),
    _renderScale: RENDER_SCALE, // supersample factor (see game-size note below)
    width: () => W,
    height: () => H,
    KColor,
    Color: KColor,
    rgb: (...a) => toColor(...a),
    vec2: (x, y) => (x instanceof Vec2 ? x.clone() : new Vec2(x ?? 0, y ?? 0)),
  };

  // active-scene accessor
  const A = () => k._active;

  // CRISPNESS: Phaser's canvas backing buffer == the game size (zoom / FIT only
  // CSS-stretch it — verified: zoom does NOT raise the buffer in 3.90). So we make
  // the buffer native by sizing the game W·S × H·S (S = RENDER_SCALE) and zoom every
  // scene camera by S (see KScene.create). World/UI coords stay 1280×720 — Phaser's
  // camera transform maps them onto the big buffer — so NO scene code changes.
  // Pointer coords are divided by S (see pointerVec) and text resolution = S.
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: Math.round(W * RENDER_SCALE),
    height: Math.round(H * RENDER_SCALE),
    backgroundColor: bg.toCSS(),
    parent: document.body,
    antialias: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [],
  });

  // A real KScene used as the pre-first-`go` surface (shows "Loading...").
  const bootKScene = new KScene("__boot", () => {}, k);
  game.scene.add("__boot", bootKScene, true);

  game.events.once("ready", () => {
    k._ready = true;
    if (k._pendingGo) { const g = k._pendingGo; k._pendingGo = null; go(g.name, g.data); }
  });

  // ── scene management ──
  k.scene = (name, fn) => {
    k._sceneFns.set(name, fn);
    if (!game.scene.getScene(name)) game.scene.add(name, new KScene(name, fn, k), false);
  };
  function go(name, data) {
    if (!k._ready) { k._pendingGo = { name, data }; return; }
    k._lastGo = { name, data }; // remembered so a window resize can re-fit the scene
    const cur = k._active;
    if (cur && cur.scene && cur.scene.key !== name && game.scene.isActive(cur.scene.key)) {
      game.scene.stop(cur.scene.key);
    }
    if (game.scene.isActive(name)) game.scene.stop(name);
    game.scene.start(name, data || {});
  }
  k.go = go;
  k.onSceneLeave = (cb) => { A()?._leaveCbs.push(cb); return { cancel() {} }; };

  // ── Responsive re-fit on window resize / orientation change ──
  // Recompute the aspect-matched design width and resize the canvas so it keeps
  // filling the screen with no letterbox. Immediate-mode scenes (onDraw) re-read
  // k.width()/k.height() every frame and adapt for free; retained-object menu
  // scenes are re-laid-out by restarting them. Live gameplay scenes are NOT
  // restarted (that would reset an active run) — their canvas still re-fits.
  if (typeof window !== "undefined") {
    const GAMEPLAY = new Set(["game", "onlineGame", "fight"]);
    let _rt;
    window.addEventListener("resize", () => {
      clearTimeout(_rt);
      _rt = setTimeout(() => {
        const nw = designW();
        if (Math.abs(nw - W) < 2) return; // aspect unchanged (e.g. height-only resize)
        W = nw;
        try { game.scale.resize(Math.round(W * RENDER_SCALE), Math.round(H * RENDER_SCALE)); } catch {}
        const a = k._active;
        if (a && a.scene && k._lastGo && !GAMEPLAY.has(a.scene.key)) go(k._lastGo.name, k._lastGo.data);
      }, 200);
    }, { passive: true });
  }

  // ── assets ──
  k.loadFont = (name, url) => {
    if (typeof FontFace === "undefined" || !document.fonts) return Promise.resolve();
    const ff = new FontFace(name, `url(${url})`);
    const p = ff.load().then((f) => { document.fonts.add(f); return f; }).catch(() => {});
    k._fontPromises.push(p);
    return p;
  };
  k.loadSprite = (name, src) => {
    try {
      if (!game.textures.exists(name)) {
        if (src instanceof HTMLCanvasElement) game.textures.addCanvas(name, src);
        else if (typeof src === "string") return game.textures.addBase64 ? Promise.resolve(game.textures.addImage(name, src)) : Promise.resolve();
      }
    } catch { /* already added / race */ }
    return Promise.resolve();
  };

  // ── color / vec / draw helpers ──
  k.rgb = (...a) => toColor(...a);
  k.vec2 = (x, y) => (x instanceof Vec2 ? x.clone() : new Vec2(x ?? 0, y ?? 0));

  // component constructors (descriptors)
  k.rect = (w, h, o = {}) => comp("rect", { w, h, radius: o.radius || 0 });
  k.circle = (r) => comp("circle", { r });
  k.text = (t, o = {}) => comp("text", { text: t, size: o.size, font: o.font, width: o.width, align: o.align });
  k.sprite = (name) => comp("sprite", { name });
  k.pos = (x, y) => comp("pos", { x, y });
  k.anchor = (a) => comp("anchor", { anchor: a });
  k.color = (...a) => comp("color", { color: toColor(...a) });
  k.outline = (w, c) => comp("outline", { width: w, color: c instanceof KColor ? c : toColor(c) });
  k.opacity = (o) => comp("opacity", { opacity: o });
  k.scale = (s) => comp("scale", { scale: s });
  k.z = (z) => comp("z", { z });
  k.fixed = () => comp("fixed", {});
  k.area = () => comp("area", {});

  // ── k.add: build a retained Phaser object from a comp list ──
  k.add = (comps) => {
    const s = A();
    if (!s) { k._preBootAdds.push(comps); return new KObj(null, { setPosition() {}, on() {}, destroy() {}, setVisible() {} }, "stub"); }

    const tags = comps.filter((c) => typeof c === "string");
    const cs = comps.filter((c) => c && c.__kcomp);
    const by = {};
    for (const c of cs) by[c.__kcomp] = c;

    // SS = supersample factor: the canvas backing is W·S × H·S, but scenes author
    // in 1280×720 design coords, so every position/size is scaled by S here.
    const SS = RENDER_SCALE;
    const px = (by.pos ? by.pos.x : 0) * SS;
    const py = (by.pos ? by.pos.y : 0) * SS;
    const anchor = by.anchor ? by.anchor.anchor : "topleft";
    const [ox, oy] = originOf(anchor);

    let go, kind;
    if (by.rect) {
      kind = "rect";
      const fill = by.color ? by.color.color.toInt() : 0xffffff;
      go = s.add.rectangle(px, py, by.rect.w * SS, by.rect.h * SS, fill, by.opacity ? by.opacity.opacity : 1);
      if (by.outline) go.setStrokeStyle(by.outline.width * SS, by.outline.color.toInt());
    } else if (by.circle) {
      kind = "circle";
      const fill = by.color ? by.color.color.toInt() : 0xffffff;
      go = s.add.circle(px, py, by.circle.r * SS, fill, by.opacity ? by.opacity.opacity : 1);
    } else if (by.text) {
      kind = "text";
      const style = {
        fontFamily: by.text.font || "gameFont",
        fontSize: Math.round((by.text.size || 22) * SS) + "px",
        color: by.color ? by.color.color.toCSS() : "#ffffff",
      };
      if (by.text.width) { style.wordWrap = { width: by.text.width * SS }; }
      if (by.text.align) style.align = by.text.align;
      go = s.add.text(px, py, by.text.text == null ? "" : String(by.text.text), style);
    } else if (by.sprite) {
      kind = "sprite";
      if (!game.textures.exists(by.sprite.name)) throw new Error("sprite not found: " + by.sprite.name);
      go = s.add.image(px, py, by.sprite.name);
    } else {
      kind = "rect";
      go = s.add.rectangle(px, py, SS, SS, 0xffffff);
    }

    go.setOrigin(ox, oy);
    if (by.opacity) go.setAlpha(by.opacity.opacity);
    // Sprites are authored at their natural texture size in design space → also ×S.
    go.setScale((by.scale ? by.scale.scale : 1) * (kind === "sprite" ? SS : 1));
    go.setDepth((by.z ? by.z.z : 0) + s._insert++ * 1e-7);
    if (by.fixed) go.setScrollFactor(0);

    const obj = new KObj(s, go, kind);
    obj._anchor = anchor;
    if (by.color) obj._baseColor = by.color.color;
    obj.tags = tags;
    if (by.area) obj._interactive();
    if (tags.length) s._track(obj, tags);
    return obj;
  };

  k.destroyAll = (tag) => {
    const s = A(); if (!s) return;
    const set = s._tagged.get(tag);
    if (!set) return;
    for (const o of set) { try { o.go.destroy(); } catch {} }
    s._tagged.delete(tag);
  };

  // ── loop / timing ──
  k.onUpdate = (cb) => { const s = A(); s._updates.push(cb); return { cancel() { const i = s._updates.indexOf(cb); if (i >= 0) s._updates.splice(i, 1); } }; };
  k.onDraw = (cb) => { const s = A(); s._draws.push(cb); return { cancel() { const i = s._draws.indexOf(cb); if (i >= 0) s._draws.splice(i, 1); } }; };
  k.dt = () => A()?._dt ?? 0;
  k.time = () => (A() ? A().time.now / 1000 : 0);
  k.wait = (sec, cb) => { const ev = A().time.delayedCall(sec * 1000, cb); return { cancel() { ev.remove(false); } }; };

  // ── camera ──
  k.camPos = (x, y) => { const s = A(); if (s) s.cameras.main.centerOn(x * RENDER_SCALE, y * RENDER_SCALE); };

  // ── immediate-mode draws ──
  // SS = supersample factor: design coords (1280×720) → the W·S × H·S backing.
  const SS = RENDER_SCALE;
  const dColor = (c) => (c instanceof KColor ? c.toInt() : colorInt(c));
  k.drawRect = (o) => {
    const s = A(); if (!s) return;
    const w = o.width * SS, h = o.height * SS;
    const [ox, oy] = originOf(o.anchor || "topleft");
    const x = o.pos.x * SS - w * ox, y = o.pos.y * SS - h * oy;
    const op = o.opacity ?? 1;
    const r = o.radius ? o.radius * SS : 0;
    const g = s._ensureGfx(!!o.fixed);
    if (o.fill !== false) {
      g.fillStyle(dColor(o.color), op);
      if (r) g.fillRoundedRect(x, y, w, h, r); else g.fillRect(x, y, w, h);
    }
    if (o.outline) {
      g.lineStyle((o.outline.width || 1) * SS, dColor(o.outline.color), op);
      if (r) g.strokeRoundedRect(x, y, w, h, r); else g.strokeRect(x, y, w, h);
    }
  };
  k.drawCircle = (o) => {
    const s = A(); if (!s) return;
    const op = o.opacity ?? 1;
    const g = s._ensureGfx(!!o.fixed);
    const cxp = o.pos.x * SS, cyp = o.pos.y * SS, r = o.radius * SS;
    if (o.fill !== false) { g.fillStyle(dColor(o.color), op); g.fillCircle(cxp, cyp, r); }
    if (o.outline) { g.lineStyle((o.outline.width || 1) * SS, dColor(o.outline.color), op); g.strokeCircle(cxp, cyp, r); }
  };
  k.drawEllipse = (o) => {
    const s = A(); if (!s) return;
    const g = s._ensureGfx(!!o.fixed);
    g.fillStyle(dColor(o.color), o.opacity ?? 1);
    g.fillEllipse(o.pos.x * SS, o.pos.y * SS, o.radiusX * 2 * SS, o.radiusY * 2 * SS);
  };
  k.drawLine = (o) => {
    const s = A(); if (!s) return;
    const g = s._ensureGfx(!!o.fixed);
    g.lineStyle((o.width || 1) * SS, dColor(o.color), o.opacity ?? 1);
    g.lineBetween(o.p1.x * SS, o.p1.y * SS, o.p2.x * SS, o.p2.y * SS);
  };
  k.drawText = (o) => {
    const s = A(); if (!s) return;
    const t = s._ensureText(!!o.fixed);
    const [ox, oy] = originOf(o.anchor || "topleft");
    t.setOrigin(ox, oy);
    t.setFontFamily(o.font || "gameFont");
    t.setFontSize(Math.round((o.size || 16) * SS) + "px");
    t.setColor((o.color instanceof KColor ? o.color : toColor(o.color)).toCSS());
    t.setAlpha(o.opacity ?? 1);
    if (o.width) t.setWordWrapWidth(o.width * SS); else t.setWordWrapWidth(null);
    if (o.align) t.setAlign(o.align);
    t.setText(o.text == null ? "" : String(o.text));
    t.setPosition(o.pos.x * SS, o.pos.y * SS);
  };
  k.drawSprite = (o) => {
    const s = A(); if (!s) return;
    if (!game.textures.exists(o.sprite)) throw new Error("sprite not found: " + o.sprite);
    const im = s._ensureImg(!!o.fixed, o.sprite);
    const [ox, oy] = originOf(o.anchor || "topleft");
    im.setOrigin(ox, oy);
    if (o.width != null && o.height != null) im.setDisplaySize(o.width * SS, o.height * SS);
    else im.setScale((o.scale != null ? o.scale : 1) * SS);
    im.setAngle(o.angle || 0);
    im.setAlpha(o.opacity ?? 1);
    im.setPosition(o.pos.x * SS, o.pos.y * SS);
  };

  // ── input ──
  k.isKeyDown = (name) => { const s = A(); const key = s && s._getKey(name); return !!(key && key.isDown); };
  k.onKeyPress = (name, cb) => {
    const s = A(); const key = s && s._getKey(name);
    if (!key) return { cancel() {} };
    const h = () => cb();
    key.on("down", h);
    return { cancel() { key.off("down", h); } };
  };
  k.onKeyDown = (name, cb) => {
    const s = A(); if (!s) return { cancel() {} };
    const rec = { name, cb }; s._keyDownConts.push(rec);
    return { cancel() { const i = s._keyDownConts.indexOf(rec); if (i >= 0) s._keyDownConts.splice(i, 1); } };
  };
  k.onCharInput = (cb) => {
    const s = A(); if (!s) return { cancel() {} };
    const h = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key && e.key.length === 1) cb(e.key);
    };
    window.addEventListener("keydown", h);
    s._disposables.push(() => window.removeEventListener("keydown", h));
    return { cancel() { window.removeEventListener("keydown", h); } };
  };
  // Pointer is in canvas-buffer pixels (0..W·S); divide by S back to world (design)
  // coords so fixed-space UI hit-testing (joystick, card grids) stays correct.
  const pointerVec = (p) => new Vec2(p.x / RENDER_SCALE, p.y / RENDER_SCALE);
  k.mousePos = () => { const s = A(); const p = s?.input?.activePointer; return p ? pointerVec(p) : new Vec2(0, 0); };
  k.onMousePress = (cb) => {
    const s = A(); if (!s) return { cancel() {} };
    const h = (p) => { if (!p.wasTouch) cb(pointerVec(p)); };
    s.input.on("pointerdown", h);
    return { cancel() { s.input.off("pointerdown", h); } };
  };
  k.onMouseMove = (cb) => {
    const s = A(); if (!s) return { cancel() {} };
    const h = (p) => { if (!p.wasTouch) cb(pointerVec(p)); };
    s.input.on("pointermove", h);
    return { cancel() { s.input.off("pointermove", h); } };
  };
  k.onMouseRelease = (cb) => {
    const s = A(); if (!s) return { cancel() {} };
    const h = (p) => { if (!p.wasTouch) cb(pointerVec(p)); };
    s.input.on("pointerup", h);
    return { cancel() { s.input.off("pointerup", h); } };
  };
  k.onScroll = (cb) => {
    const s = A(); if (!s) return { cancel() {} };
    const h = (_p, _o, dx, dy) => cb(new Vec2(dx, dy));
    s.input.on("wheel", h);
    return { cancel() { s.input.off("wheel", h); } };
  };
  const touchInfo = (p) => ({ identifier: p.identifier ?? p.id ?? 0 });
  k.onTouchStart = (cb) => {
    const s = A(); if (!s) return { cancel() {} };
    const h = (p) => { if (p.wasTouch) cb(pointerVec(p), touchInfo(p)); };
    s.input.on("pointerdown", h);
    return { cancel() { s.input.off("pointerdown", h); } };
  };
  k.onTouchMove = (cb) => {
    const s = A(); if (!s) return { cancel() {} };
    const h = (p) => { if (p.wasTouch) cb(pointerVec(p), touchInfo(p)); };
    s.input.on("pointermove", h);
    return { cancel() { s.input.off("pointermove", h); } };
  };
  k.onTouchEnd = (cb) => {
    const s = A(); if (!s) return { cancel() {} };
    const h = (p) => { if (p.wasTouch) cb(pointerVec(p), touchInfo(p)); };
    s.input.on("pointerup", h);
    return { cancel() { s.input.off("pointerup", h); } };
  };
  k.isTouchscreen = () => game.device.input.touch || "ontouchstart" in window;
  k.setCursor = (style) => { if (game.canvas) game.canvas.style.cursor = style || "default"; };

  return k;
}
