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
 * Resolve the requested backend from a URL query string + a storage getter. Opt-in only:
 * `?backend=canvas` (or `=phaser`) wins; else `tq_backend` in storage; else null (Phaser default).
 * Pure so it can be unit-tested without a browser.
 * @param {string} search    location.search (e.g. "?backend=canvas")
 * @param {(k:string)=>(string|null)} storageGet  localStorage.getItem-style getter
 * @returns {"canvas"|"phaser"|null}
 */
export function backendFlag(search = "", storageGet = () => null) {
  let q = null;
  try { q = new URLSearchParams(search || "").get("backend"); } catch { q = null; }
  const pick = (v) => (v === "canvas" || v === "phaser" ? v : null);
  const fromUrl = pick(q && q.toLowerCase());
  if (fromUrl) return fromUrl;
  let s = null;
  try { s = storageGet("tq_backend"); } catch { s = null; }
  return pick(s && String(s).toLowerCase());
}

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

/** True when the opt-in canvas backend is requested (reads the live URL + localStorage; defensive). */
export function canvasBackendRequested() {
  let search = "";
  try { search = (typeof location !== "undefined" && location.search) || ""; } catch { search = ""; }
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  return backendFlag(search, get) === "canvas";
}

// ── Core immediate-mode primitives (author in DESIGN coords; the runtime applies DPR×FIT) ──
// Signatures intentionally mirror the shape the k.draw* shim accepts ({ pos, color, opacity, … }) so
// TQ-251 can route a real scene's draw calls through these with minimal glue.

const rgba = (c, o = 1) => `rgba(${(c && c[0]) | 0},${(c && c[1]) | 0},${(c && c[2]) | 0},${o})`;

// TQ-273 (Phase 2): fill (default true) + optional outline {width,color} matching k.drawRect — scenes
// draw bordered panels/buttons (fill+outline) and outline-only frames (fill:false) through both.
export function cDrawRect(ctx, { x = 0, y = 0, w = 0, h = 0, color = [255, 255, 255], opacity = 1, radius = 0, fill = true, outline = null } = {}) {
  const r = radius > 0 ? Math.min(radius, w / 2, h / 2) : 0;
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  if (fill !== false) {
    ctx.fillStyle = rgba(color, opacity);
    if (r) { trace(); ctx.fill(); } else ctx.fillRect(x, y, w, h);
  }
  if (outline) {
    ctx.strokeStyle = rgba(outline.color || color, opacity);
    ctx.lineWidth = Math.max(0.1, outline.width || 1);
    if (r) { trace(); ctx.stroke(); } else ctx.strokeRect(x, y, w, h);
  }
}

// TQ-273 (Phase 2): fill (default true) + optional outline {width,color} matching k.drawCircle —
// supports outline-only selection/range rings (fill:false).
export function cDrawCircle(ctx, { x = 0, y = 0, radius = 1, color = [255, 255, 255], opacity = 1, fill = true, outline = null } = {}) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, radius), 0, Math.PI * 2);
  if (fill !== false) { ctx.fillStyle = rgba(color, opacity); ctx.fill(); }
  if (outline) {
    ctx.strokeStyle = rgba(outline.color || color, opacity);
    ctx.lineWidth = Math.max(0.1, outline.width || 1);
    ctx.stroke();
  }
}

// TQ-272 (Phase 2): mirrors k.drawEllipse ({ pos, radiusX, radiusY, … }) — radiusX/radiusY are RADII
// (k.drawEllipse passes radius*2 to Phaser's fillEllipse, which takes a diameter; ctx.ellipse takes radii).
export function cDrawEllipse(ctx, { x = 0, y = 0, radiusX = 1, radiusY = 1, color = [255, 255, 255], opacity = 1 } = {}) {
  ctx.fillStyle = rgba(color, opacity);
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0, radiusX), Math.max(0, radiusY), 0, 0, Math.PI * 2);
  ctx.fill();
}

export function cDrawLine(ctx, { p1 = { x: 0, y: 0 }, p2 = { x: 0, y: 0 }, width = 1, color = [255, 255, 255], opacity = 1 } = {}) {
  ctx.strokeStyle = rgba(color, opacity);
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

// TQ-272 (Phase 2): adds `width` (wrap width, design px) + `lineHeight` to the spike's text primitive,
// matching k.drawText. width=0 (default) is the existing single-line behavior, so callers are unaffected.
export function cDrawText(ctx, { text = "", x = 0, y = 0, size = 16, color = [255, 255, 255], opacity = 1, anchor = "topleft", font = "sans-serif", width = 0, lineHeight = 0 } = {}) {
  ctx.fillStyle = rgba(color, opacity);
  // PERF (TQ-336): assigning ctx.font RE-PARSES the font shorthand every call — a CPU profile of the
  // roster scene put cDrawText at ~22% self-time, dominated by this. Most text in a scene shares one
  // size+font, so only assign when the value actually differs. Read-compare against the live ctx.*
  // (not a JS cache) so it stays correct across the renderer's save()/restore() + clip pushes —
  // ctx.font/textBaseline/textAlign getters always report the true current state. Worst case (a getter
  // doesn't round-trip a value) it just assigns as before — never wrong, only ever a skipped re-parse.
  const wantFont = `${size}px ${font}`;
  if (ctx.font !== wantFont) ctx.font = wantFont;
  const wantBaseline = anchor.includes("center") ? "middle" : "top";
  if (ctx.textBaseline !== wantBaseline) ctx.textBaseline = wantBaseline;
  const wantAlign = anchor === "center" || anchor === "top" || anchor === "bot" ? "center" : anchor.includes("right") ? "right" : "left";
  if (ctx.textAlign !== wantAlign) ctx.textAlign = wantAlign;
  const lines = width > 0 ? wrapText((str) => ctx.measureText(str).width, text, width) : [String(text)];
  const lh = lineHeight > 0 ? lineHeight : Math.round(size * 1.25);
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], x, y + i * lh);
}

export function cDrawPoly(ctx, { points = [], color = [255, 255, 255], opacity = 1 } = {}) {
  if (!Array.isArray(points) || points.length < 3) return;
  ctx.fillStyle = rgba(color, opacity);
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
    canvas.width = Math.round(winW * dpr);
    canvas.height = Math.round(winH * dpr);
    // TQ-294: aspect-match FILL (no letterbox) — design width tracks the window aspect, H fixed; the
    // stage fills the window. stats.designW exposes the live width so the shim's k.width() tracks it.
    const vp = viewport(winW, winH);
    canvas._tq = { dpr, vp };
    stats.designW = vp.W;
  };
  resize();
  if (typeof addEventListener !== "undefined") addEventListener("resize", resize);

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
  return { canvas, stats, stop() {
    try { cancelAnimationFrame(raf); } catch { /* ok */ }
    for (const [type, h] of pointerHandlers) { try { canvas.removeEventListener(type, h); } catch { /* ok */ } } // TQ-279
    try { canvas.remove(); } catch { /* ok */ }
  } };
}

// On-screen frame meter, used by the representative lobby scene (drawLobby). Reads the rolling
// stats the runtime maintains.
function drawFrameMeter(ctx, label) {
  let s = { fps: 0, ms: 0 };
  try { s = window.__tqCanvasStats || s; } catch { /* no window */ }
  cDrawRect(ctx, { x: 8, y: 8, w: 320, h: 34, color: [0, 0, 0], opacity: 0.55, radius: 6 });
  cDrawText(ctx, { text: `${label} — ${s.fps} fps / ${s.ms} ms`, x: 18, y: 16, size: 18, color: [70, 230, 198] });
}

// TQ-251: a RECOGNISABLE lobby/village rendered with the canvas-backend primitives — the
// representative scene for the de-risk spike (NOT the real hub.js; pixel-perfect parity is out of
// scope). It mirrors the hub's composition + density (grass + crossing dirt paths, a central well,
// seven roofed buildings with signs, hanging lanterns, drifting fireflies, a few keepers) so the
// TQ-252 perf benchmark measures a realistic immediate-mode load. Deterministic (index-based trig).
const BUILDINGS = [
  { x: 200, y: 200, label: "Shop" }, { x: 430, y: 150, label: "Healer" }, { x: 660, y: 140, label: "Merchant" },
  { x: 890, y: 160, label: "Bestiary" }, { x: 1060, y: 250, label: "Cosmetics" }, { x: 300, y: 470, label: "Roster" },
  { x: 980, y: 480, label: "Upgrades" },
];
export function drawLobby(ctx, t) {
  // Ground — banded grass for a little depth.
  for (let i = 0; i < 12; i++) cDrawRect(ctx, { x: 0, y: i * 60, w: DESIGN_W, h: 60, color: [34 + (i % 2) * 8, 84 + (i % 2) * 10, 46], opacity: 1 });
  // Crossing dirt paths to the centre (the village green).
  cDrawRect(ctx, { x: 590, y: 0, w: 100, h: DESIGN_H, color: [120, 96, 64], opacity: 0.95 });
  cDrawRect(ctx, { x: 0, y: 320, w: DESIGN_W, h: 90, color: [120, 96, 64], opacity: 0.95 });
  cDrawCircle(ctx, { x: 640, y: 360, radius: 150, color: [126, 102, 70], opacity: 0.9 });
  // Seven buildings: shadow, body, roof (triangle), door, sign label.
  for (const b of BUILDINGS) {
    cDrawCircle(ctx, { x: b.x + 45, y: b.y + 96, radius: 50, color: [0, 0, 0], opacity: 0.18 });
    cDrawRect(ctx, { x: b.x, y: b.y + 18, w: 90, h: 78, color: [150, 120, 92], radius: 4 });
    cDrawPoly(ctx, { points: [{ x: b.x - 10, y: b.y + 20 }, { x: b.x + 45, y: b.y - 18 }, { x: b.x + 100, y: b.y + 20 }], color: [122, 70, 56] });
    cDrawRect(ctx, { x: b.x + 33, y: b.y + 56, w: 24, h: 40, color: [60, 42, 30], radius: 3 });
    cDrawRect(ctx, { x: b.x + 6, y: b.y - 2, w: 78, h: 18, color: [0, 0, 0], opacity: 0.5, radius: 4 });
    cDrawText(ctx, { text: b.label, x: b.x + 45, y: b.y + 1, size: 13, color: [240, 235, 220], anchor: "top" });
    // Hanging lantern with a soft halo (two circles) — flickers.
    const fl = 0.7 + Math.sin(t * 3 + b.x) * 0.3;
    cDrawCircle(ctx, { x: b.x - 4, y: b.y + 30, radius: 16, color: [255, 200, 110], opacity: 0.22 * fl });
    cDrawCircle(ctx, { x: b.x - 4, y: b.y + 30, radius: 5, color: [255, 224, 150], opacity: fl });
  }
  // Central well: stone ring + posts + roof.
  cDrawCircle(ctx, { x: 640, y: 362, radius: 34, color: [90, 92, 100] });
  cDrawCircle(ctx, { x: 640, y: 362, radius: 24, color: [22, 28, 38] });
  cDrawPoly(ctx, { points: [{ x: 604, y: 330 }, { x: 640, y: 300 }, { x: 676, y: 330 }], color: [122, 70, 56] });
  // A few keepers / players milling about (head + body).
  for (let i = 0; i < 9; i++) {
    const px = 360 + i * 70 + Math.sin(t + i) * 14, py = 430 + (i % 3) * 26;
    cDrawCircle(ctx, { x: px, y: py + 14, radius: 11, color: [60, 70, 110] });
    cDrawCircle(ctx, { x: px, y: py - 4, radius: 7, color: [224, 196, 164] });
  }
  // Drifting fireflies — the dense moving load.
  for (let i = 0; i < 90; i++) {
    const a = t * 0.6 + i * 0.7;
    const x = 640 + Math.cos(a) * (180 + (i % 13) * 28);
    const y = 360 + Math.sin(a * 1.1) * (120 + (i % 7) * 20);
    cDrawCircle(ctx, { x, y, radius: 2 + (i % 3), color: [200, 255, 180], opacity: 0.5 + Math.sin(t * 4 + i) * 0.3 });
  }
  // TQ-272/273: pond (ellipse), an outline-only ring at the well (fill:false), a BORDERED notice panel
  // (fill+outline) + wrapped text — exercises the Phase-2 primitive set every frame.
  cDrawEllipse(ctx, { x: 150, y: 610, radiusX: 95, radiusY: 38, color: [58, 110, 150], opacity: 0.85 });
  cDrawEllipse(ctx, { x: 150, y: 606, radiusX: 70, radiusY: 26, color: [86, 150, 190], opacity: 0.6 });
  cDrawCircle(ctx, { x: 640, y: 362, radius: 44, opacity: 0.85, fill: false, outline: { width: 3, color: [70, 230, 198] } });
  cDrawRect(ctx, { x: 966, y: 576, w: 286, h: 74, color: [0, 0, 0], opacity: 0.4, radius: 8, outline: { width: 2, color: [70, 230, 198] } });
  cDrawText(ctx, { text: "Welcome to the Village Square — trade, heal, and gear up before your next run.", x: 980, y: 588, size: 14, color: [240, 235, 220], anchor: "topleft", width: 250 });
  cDrawText(ctx, { text: "Village Square", x: 640, y: 30, size: 24, color: [240, 243, 244], anchor: "top" });
  drawFrameMeter(ctx, "canvas2D — lobby");
}
