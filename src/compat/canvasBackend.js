// TQ-250 (engine-removal epic TQ-227): the raw-canvas2D mini-runtime + the CORE immediate-mode
// primitive set the scenes use. Began as an opt-in de-risk spike ("is a hand-rolled canvas2D backend
// viable + fast enough to drop the engine?"); as of TQ-298 it is the SOLE renderer — the old Phaser
// compat shim + the `phaser` dependency were removed, so this runtime backs every scene.
//
// Here we stand up the runtime (DPR/FIT sizing + a requestAnimationFrame loop) and the primitives
// (rect/circle/text/line with pos/anchor/colour/opacity), and prove they paint a synthetic frame.

// ── Pure, DOM-free helpers (unit-testable) ──────────────────────────────────

const DESIGN_W = 1280, DESIGN_H = 720; // the design canvas every scene authors against

/**
 * Letterbox FIT: the largest uniform scale that fits the DESIGN_W×DESIGN_H stage inside the window,
 * plus the centring offset (CSS px). Mirrors the Phaser FIT/letterbox the shim uses so canvas-backend
 * scenes would land in the same place. Pure.
 * @returns {{scale:number, offX:number, offY:number, w:number, h:number}}
 */
export function fitScale(winW, winH, designW = DESIGN_W, designH = DESIGN_H) {
  const safeW = Math.max(1, winW || 0), safeH = Math.max(1, winH || 0);
  const scale = Math.min(safeW / designW, safeH / designH);
  const w = designW * scale, h = designH * scale;
  return { scale, offX: (safeW - w) / 2, offY: (safeH - h) / 2, w, h };
}

/**
 * TQ-294 (cutover item 4): aspect-matched design WIDTH (height fixed at designH). The buffer aspect ==
 * the window aspect, so the FIT-scaled canvas fills the screen with ZERO letterbox bars on any aspect
 * (5:4 … 21:9, portrait). Clamped 240..5120. Mirrors kaboomShim.js designW so the canvas backend lays
 * out exactly like the live Phaser path. Pure.
 */
export function designWidthFor(winW, winH, designH = DESIGN_H) {
  const ww = Math.max(1, winW || 0), wh = Math.max(1, winH || 0);
  return Math.round(Math.max(240, Math.min(5120, designH * (ww / wh))));
}

/**
 * TQ-294: the aspect-match viewport — { W (dynamic design width), H (designH), scale (CSS px per design
 * unit = winH/H) }. The stage FILLS the window (W*scale == winW by construction; no offset/letterbox).
 * @returns {{W:number,H:number,scale:number}}
 */
export function viewport(winW, winH, designH = DESIGN_H) {
  return { W: designWidthFor(winW, winH, designH), H: designH, scale: Math.max(1, winH || 0) / designH };
}

/**
 * TQ-279/294: map a DOM pointer event (CSS px, viewport-relative clientX/clientY) to DESIGN coords — the
 * inverse of the aspect-match transform: subtract the canvas's top-left, divide by the FIT scale
 * (= rect.height/designH). No letterbox offset (the stage fills). Pointer events are CSS px so DPR cancels.
 * Pure; feeds the retained-layer hit-testing (TQ-277).
 * @param {number} clientX @param {number} clientY @param {{left?:number,top?:number,width?:number,height?:number}} rect
 * @returns {{x:number,y:number}} design coords
 */
export function pointerToDesign(clientX, clientY, rect, designH = DESIGN_H) {
  const r = rect || {};
  const scale = Math.max(1, r.height || designH) / designH;
  return { x: (clientX - (r.left || 0)) / scale, y: (clientY - (r.top || 0)) / scale };
}

// ── Core immediate-mode primitives (author in DESIGN coords; the runtime applies DPR×FIT) ──
// Signatures intentionally mirror the shape the k.draw* shim accepts ({ pos, color, opacity, … }) so
// TQ-251 can route a real scene's draw calls through these with minimal glue.

// Accepts an [r,g,b] array OR a KColor-shaped {r,g,b} object — so the k.draw* adapter (canvasRenderer.js)
// can pass scene colours straight through WITHOUT allocating an intermediate [r,g,b] array per draw call
// (toRGB did that on every rect/circle/ellipse/line/polygon). null/undefined → white, matching the
// adapter's old toRGB default. Output is byte-identical to the previous toRGB(color)+rgba(arr) chain.
const rgba = (c, o = 1) =>
  c && typeof c.r === "number" ? `rgba(${c.r | 0},${c.g | 0},${c.b | 0},${o})`
    : Array.isArray(c) ? `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${o})`
      : `rgba(255,255,255,${o})`;

// TQ-343: a fill/stroke SHADOW guard. The CDP profile showed the dominant per-frame render cost is the
// style ASSIGNMENT — `ctx.fillStyle = "rgba(...)"` re-parses the colour string for EVERY primitive, hundreds
// of times a frame, even when consecutive primitives share a colour (a run of same-colour glyphs, repeated
// panel/tile fills). These setters skip the assignment (and so the reparse) when the string is unchanged
// since the last write THROUGH THE SAME shadow. Correctness rests on the shadow tracking the ctx's TRUE
// fill/stroke state: it's owned by canvasRenderer (per-frame fresh, reset on every pushClip/popClip ctx
// save/restore), and on the live render ctx ONLY these cDraw* primitives write fillStyle/strokeStyle (every
// other .fillStyle in the codebase targets an offscreen bake canvas — verified). Output is byte-identical;
// only redundant assignments are dropped. `st` null ⇒ unguarded (the prior always-assign behaviour; tests).
function setFill(ctx, s, st) { if (st) { if (st.fill !== s) { ctx.fillStyle = s; st.fill = s; } } else ctx.fillStyle = s; }
function setStroke(ctx, s, st) { if (st) { if (st.stroke !== s) { ctx.strokeStyle = s; st.stroke = s; } } else ctx.strokeStyle = s; }

// Trace a rounded-rect path. Hoisted to module scope so cDrawRect (one of the hottest primitives — every
// tile/HUD/panel/bar rect routes through it) doesn't allocate a fresh closure on EVERY call: the rounded
// path is needed only when radius>0, but the common square rect (radius 0) used to pay the closure alloc
// regardless. Square rects now allocate nothing here; rounded ones share this single function.
function traceRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// TQ-273 (Phase 2): fill (default true) + optional outline {width,color} matching k.drawRect — scenes
// draw bordered panels/buttons (fill+outline) and outline-only frames (fill:false) through both.
export function cDrawRect(ctx, { x = 0, y = 0, w = 0, h = 0, color = [255, 255, 255], opacity = 1, radius = 0, fill = true, outline = null } = {}, style = null) {
  const r = radius > 0 ? Math.min(radius, w / 2, h / 2) : 0;
  if (fill !== false) {
    setFill(ctx, rgba(color, opacity), style);
    if (r) { traceRoundRect(ctx, x, y, w, h, r); ctx.fill(); } else ctx.fillRect(x, y, w, h);
  }
  if (outline) {
    setStroke(ctx, rgba(outline.color || color, opacity), style);
    ctx.lineWidth = Math.max(0.1, outline.width || 1);
    if (r) { traceRoundRect(ctx, x, y, w, h, r); ctx.stroke(); } else ctx.strokeRect(x, y, w, h);
  }
}

// TQ-273 (Phase 2): fill (default true) + optional outline {width,color} matching k.drawCircle —
// supports outline-only selection/range rings (fill:false).
export function cDrawCircle(ctx, { x = 0, y = 0, radius = 1, color = [255, 255, 255], opacity = 1, fill = true, outline = null } = {}, style = null) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, radius), 0, Math.PI * 2);
  if (fill !== false) { setFill(ctx, rgba(color, opacity), style); ctx.fill(); }
  if (outline) {
    setStroke(ctx, rgba(outline.color || color, opacity), style);
    ctx.lineWidth = Math.max(0.1, outline.width || 1);
    ctx.stroke();
  }
}

// TQ-272 (Phase 2): mirrors k.drawEllipse ({ pos, radiusX, radiusY, … }) — radiusX/radiusY are RADII
// (k.drawEllipse passes radius*2 to Phaser's fillEllipse, which takes a diameter; ctx.ellipse takes radii).
export function cDrawEllipse(ctx, { x = 0, y = 0, radiusX = 1, radiusY = 1, color = [255, 255, 255], opacity = 1 } = {}, style = null) {
  setFill(ctx, rgba(color, opacity), style);
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0, radiusX), Math.max(0, radiusY), 0, 0, Math.PI * 2);
  ctx.fill();
}

export function cDrawLine(ctx, { p1 = { x: 0, y: 0 }, p2 = { x: 0, y: 0 }, width = 1, color = [255, 255, 255], opacity = 1 } = {}, style = null) {
  setStroke(ctx, rgba(color, opacity), style);
  ctx.lineWidth = Math.max(0.1, width);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
}

/**
 * TQ-272 (Phase 2): greedy word-wrap, mirroring k.drawText's `width` (Phaser setWordWrapWidth). Splits
 * `text` into lines no wider than `maxWidth` using an INJECTED `measure(str)->px` (so it's unit-testable
 * without a canvas). Explicit newlines are honored; a single word wider than maxWidth stands on its own
 * line (no mid-word break). Returns the newline-split lines unchanged when maxWidth is falsy. Pure.
 * @param {(s:string)=>number} measure @param {string} text @param {number} maxWidth @returns {string[]}
 */
export function wrapText(measure, text, maxWidth) {
  const s = String(text == null ? "" : text);
  if (!maxWidth || maxWidth <= 0) return s.split("\n");
  const out = [];
  for (const para of s.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(""); continue; }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = `${line} ${words[i]}`;
      if (measure(test) <= maxWidth) line = test;
      else { out.push(line); line = words[i]; }
    }
    out.push(line);
  }
  return out;
}

// Anchor → canvas textBaseline / textAlign. Exported as the SINGLE source of truth so the label-texture
// cache (canvasTextCache.js) bakes glyphs with the exact same baseline/alignment the direct path uses —
// any divergence would shift cached labels off their direct-draw position.
export function textBaselineFor(anchor) { return anchor.includes("center") ? "middle" : "top"; }
export function textAlignFor(anchor) { return anchor === "center" || anchor === "top" || anchor === "bot" ? "center" : anchor.includes("right") ? "right" : "left"; }

// TQ-272 (Phase 2): adds `width` (wrap width, design px) + `lineHeight` to the spike's text primitive,
// matching k.drawText. width=0 (default) is the existing single-line behavior, so callers are unaffected.
//
// TQ-443 (opt 1, "batch text by style"): an optional `state` ({font,baseline,align}) lets the caller skip
// re-assigning ctx.font/textBaseline/textAlign when they're unchanged since the last text draw. TQ-336
// found a ctx.font *getter*-read guard was noise (the getter read cost offset the saved parse). This is a
// JS-shadow guard instead — a free string compare, no getter — and it's correct because font/textBaseline/
// textAlign are mutated ONLY by text draws (no rect/circle/sprite touches them), so the shadow can't go
// stale between text calls. It's invalidated on pushClip/popClip (which save/restore ctx state) and is
// per-frame (the renderer is rebuilt each frame). fillStyle is NOT guarded here — every primitive writes
// it, so a text-local shadow would be wrong; the label cache (opt 2) removes its parse for stable text.
export function cDrawText(ctx, { text = "", x = 0, y = 0, size = 16, color = [255, 255, 255], opacity = 1, anchor = "topleft", font = "sans-serif", width = 0, lineHeight = 0 } = {}, state = null) {
  setFill(ctx, rgba(color, opacity), state); // TQ-343: the fill guard now spans text too (state carries .fill alongside .font/.baseline/.align)
  const fontStr = `${size}px ${font}`;
  const baseline = textBaselineFor(anchor);
  const align = textAlignFor(anchor);
  if (state) {
    if (state.font !== fontStr) { ctx.font = fontStr; state.font = fontStr; }
    if (state.baseline !== baseline) { ctx.textBaseline = baseline; state.baseline = baseline; }
    if (state.align !== align) { ctx.textAlign = align; state.align = align; }
  } else {
    ctx.font = fontStr;
    ctx.textBaseline = baseline;
    ctx.textAlign = align;
  }
  const lines = width > 0 ? wrapText((str) => ctx.measureText(str).width, text, width) : [String(text)];
  const lh = lineHeight > 0 ? lineHeight : Math.round(size * 1.25);
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], x, y + i * lh);
}

export function cDrawPoly(ctx, { points = [], color = [255, 255, 255], opacity = 1 } = {}, style = null) {
  if (!Array.isArray(points) || points.length < 3) return;
  setFill(ctx, rgba(color, opacity), style);
  ctx.beginPath();
  points.forEach((p, i) => { const x = (p && p.x) || 0, y = (p && p.y) || 0; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.closePath();
  ctx.fill();
}

// ── DOM runtime: a sized canvas + rAF loop (browser only) ───────────────────

/**
 * Create a full-window canvas runtime. `draw(ctx, t, dt)` is called each frame with the 2D context
 * already transformed into DESIGN space (DPR×FIT applied; (0,0)..(1280,720) maps to the letterboxed
 * stage). Returns { canvas, stop, stats }. Browser only (needs document + requestAnimationFrame).
 */
export function makeCanvasRuntime(draw, { mount, onPointer, hideTitle = true, zIndex = "99999" } = {}) {
  const canvas = document.createElement("canvas");
  canvas.id = "tq-canvas-backend";
  // The spike demo sits ABOVE the HTML title overlay (zIndex 99999) + hides the title so the demo is
  // visible. The REAL game (TQ-293) instead sits BEHIND the title (low zIndex) and leaves the title for
  // the scenes to control — pass { hideTitle:false, zIndex:"0" }.
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", zIndex, background: "#12141b", display: "block" });
  (mount || document.body).appendChild(canvas);
  if (hideTitle) { try { const ttl = document.getElementById("title"); if (ttl) { ttl.style.display = "none"; } } catch { /* no DOM */ } }
  const ctx = canvas.getContext("2d");

  // TQ-279 (Phase 4): optional pointer input. Attach DOM pointer listeners, map each event to design
  // coords (pointerToDesign), and hand them to onPointer(kind, x, y, event) — the caller drives a
  // retained layer's pointerDown/pointerMove (TQ-277) with real input. No listeners without onPointer.
  const pointerHandlers = [];
  if (typeof onPointer === "function") {
    const dispatch = (kind) => (e) => { const p = pointerToDesign(e.clientX, e.clientY, canvas.getBoundingClientRect()); onPointer(kind, p.x, p.y, e); };
    for (const [type, kind] of [["pointerdown", "down"], ["pointermove", "move"], ["pointerup", "up"]]) {
      const h = dispatch(kind); canvas.addEventListener(type, h); pointerHandlers.push([type, h]);
    }
  }

  const stats = { fps: 0, ms: 0, frames: 0 };
  let raf = 0, t0 = 0, last = 0, ema = 0;

  const resize = () => {
    const dpr = Math.max(1, Math.min(3, (typeof devicePixelRatio !== "undefined" && devicePixelRatio) || 1));
    const winW = canvas.clientWidth || (typeof innerWidth !== "undefined" ? innerWidth : DESIGN_W);
    const winH = canvas.clientHeight || (typeof innerHeight !== "undefined" ? innerHeight : DESIGN_H);
    const cw = Math.round(winW * dpr), ch = Math.round(winH * dpr);
    // Only reassign on a real change — setting canvas.width/height CLEARS the canvas + resets ctx state, and
    // resize() is now called repeatedly (the settle passes + visualViewport.resize below), so a no-op call
    // must not flicker the frame.
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    // TQ-294: aspect-match FILL (no letterbox) — design width tracks the window aspect, H fixed; the
    // stage fills the window. stats.designW exposes the live width so the shim's k.width() tracks it.
    const vp = viewport(winW, winH);
    canvas._tq = { dpr, vp };
    stats.designW = vp.W;
  };
  resize();
  // TQ-524: iOS standalone (home-screen webapp) reports STALE clientWidth/Height while an orientation change
  // is in flight — `resize`/`orientationchange` fire BEFORE the layout viewport reflows and, unlike mobile
  // Safari, iOS does NOT fire a follow-up event once it settles. A single synchronous resize() therefore
  // locks in the pre-rotation size (the "resolution bugs out on rotate" in standalone PWA mode). Re-run
  // resize across the settle window — now, next frame, and a couple of delayed passes — so the final pass
  // reads the correct post-rotation size. orientationchange + visualViewport.resize are the reliable iOS
  // rotation signals; resize() is idempotent (above) so the extra passes are free when nothing changed.
  const resettle = () => {
    resize();
    try { requestAnimationFrame(resize); } catch { /* no rAF */ }
    try { setTimeout(resize, 250); setTimeout(resize, 550); } catch { /* no timers */ }
  };
  if (typeof addEventListener !== "undefined") {
    addEventListener("resize", resettle);
    addEventListener("orientationchange", resettle);
  }
  if (typeof visualViewport !== "undefined" && visualViewport && visualViewport.addEventListener) {
    visualViewport.addEventListener("resize", resettle);
  }
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("fullscreenchange", resettle);
    document.addEventListener("webkitfullscreenchange", resettle);
  }

  const frame = (now) => {
    if (!t0) t0 = now;
    const dt = last ? (now - last) : 16.7;
    last = now;
    ema = ema ? ema * 0.9 + dt * 0.1 : dt;
    stats.ms = Math.round(ema * 100) / 100;
    stats.fps = ema > 0 ? Math.round(1000 / ema) : 0;
    stats.frames++;

    const { dpr, vp } = canvas._tq;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    // TQ-294: aspect-match FILL — uniform DPR×scale, NO letterbox offset; draw() authors in (0..vp.W)×(0..720).
    ctx.setTransform(vp.scale * dpr, 0, 0, vp.scale * dpr, 0, 0);
    try { draw(ctx, (now - t0) / 1000, dt / 1000, stats); } catch (e) { /* keep the loop alive */ void e; }
    ctx.restore();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  try { window.__tqCanvasStats = stats; } catch { /* no window */ }
  return { canvas, stats, resize, stop() {
    try { cancelAnimationFrame(raf); } catch { /* ok */ }
    for (const [type, h] of pointerHandlers) { try { canvas.removeEventListener(type, h); } catch { /* ok */ } } // TQ-279
    try { canvas.remove(); } catch { /* ok */ }
  } };
}

// (TQ-339 follow-up) The TQ-251 spike's representative `drawLobby` + its `drawFrameMeter`/`BUILDINGS`
// were removed as dead code: Phaser was retired (TQ-298) so the `?backend=canvas` route that rendered
// them is gone, and the real scenes (hub.js etc.) are the shipped lobby. The runtime still exposes its
// rolling frame stats via window.__tqCanvasStats (above) for external/QA FPS reads.
