// TQ-250 (Phase-1 de-risk spike for the engine-removal epic TQ-227 / story TQ-228): a STANDALONE
// raw-canvas2D mini-runtime selected by an opt-in flag, with the CORE immediate-mode primitive set
// the scenes use. This exists ONLY to answer "is a hand-rolled canvas2D backend viable + fast enough
// to drop Phaser?" — it is additive and flag-gated, so the live Phaser path (src/main.js +
// src/compat/kaboomShim.js) is completely untouched with the flag off.
//
// What this does NOT do yet: render a real scene (TQ-251) or benchmark vs Phaser (TQ-252). Here we
// stand up the runtime (DPR/FIT sizing + a requestAnimationFrame loop) and the primitives
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

export function cDrawRect(ctx, { x = 0, y = 0, w = 0, h = 0, color = [255, 255, 255], opacity = 1, radius = 0 } = {}) {
  ctx.fillStyle = rgba(color, opacity);
  if (radius > 0) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillRect(x, y, w, h);
  }
}

export function cDrawCircle(ctx, { x = 0, y = 0, radius = 1, color = [255, 255, 255], opacity = 1 } = {}) {
  ctx.fillStyle = rgba(color, opacity);
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, radius), 0, Math.PI * 2);
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

export function cDrawText(ctx, { text = "", x = 0, y = 0, size = 16, color = [255, 255, 255], opacity = 1, anchor = "topleft", font = "sans-serif" } = {}) {
  ctx.fillStyle = rgba(color, opacity);
  ctx.font = `${size}px ${font}`;
  ctx.textBaseline = anchor.includes("center") ? "middle" : "top";
  ctx.textAlign = anchor === "center" || anchor === "top" || anchor === "bot" ? "center" : anchor.includes("right") ? "right" : "left";
  ctx.fillText(String(text), x, y);
}

// ── DOM runtime: a sized canvas + rAF loop (browser only) ───────────────────

/**
 * Create a full-window canvas runtime. `draw(ctx, t, dt)` is called each frame with the 2D context
 * already transformed into DESIGN space (DPR×FIT applied; (0,0)..(1280,720) maps to the letterboxed
 * stage). Returns { canvas, stop, stats }. Browser only (needs document + requestAnimationFrame).
 */
export function makeCanvasRuntime(draw, { mount } = {}) {
  const canvas = document.createElement("canvas");
  canvas.id = "tq-canvas-backend";
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", zIndex: "1", background: "#12141b", display: "block" });
  (mount || document.body).appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const stats = { fps: 0, ms: 0, frames: 0 };
  let raf = 0, t0 = 0, last = 0, ema = 0;

  const resize = () => {
    const dpr = Math.max(1, Math.min(3, (typeof devicePixelRatio !== "undefined" && devicePixelRatio) || 1));
    const winW = canvas.clientWidth || (typeof innerWidth !== "undefined" ? innerWidth : DESIGN_W);
    const winH = canvas.clientHeight || (typeof innerHeight !== "undefined" ? innerHeight : DESIGN_H);
    canvas.width = Math.round(winW * dpr);
    canvas.height = Math.round(winH * dpr);
    const fit = fitScale(winW, winH);
    // Compose DPR then FIT so draw() authors in design units, centred + letterboxed like Phaser FIT.
    canvas._tq = { dpr, fit };
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

    const { dpr, fit } = canvas._tq;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.setTransform(fit.scale * dpr, 0, 0, fit.scale * dpr, fit.offX * dpr, fit.offY * dpr);
    try { draw(ctx, (now - t0) / 1000, dt / 1000, stats); } catch (e) { /* keep the loop alive */ void e; }
    ctx.restore();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  try { window.__tqCanvasStats = stats; } catch { /* no window */ }
  return { canvas, stats, stop() { try { cancelAnimationFrame(raf); } catch { /* ok */ } try { canvas.remove(); } catch { /* ok */ } } };
}

/**
 * Boot the standalone canvas-backend DEMO: a synthetic, animated, lobby-ish immediate-mode load
 * (rects + circles + text + lines) that exercises every primitive every frame, plus an on-screen
 * frame meter. This is the TQ-250 deliverable — proof the runtime + primitives paint at the right DPR.
 * TQ-251 will replace the synthetic draw with a real scene; TQ-252 reads window.__tqCanvasStats.
 */
export function startCanvasBackendDemo() {
  const palette = [[70, 230, 198], [98, 160, 255], [255, 184, 66], [222, 74, 40], [176, 230, 116], [184, 134, 222]];
  return makeCanvasRuntime((ctx, t) => {
    // Backdrop
    cDrawRect(ctx, { x: 0, y: 0, w: DESIGN_W, h: DESIGN_H, color: [18, 20, 27] });
    // A field of animated tiles (rects) — the bulk of a scene's fills.
    for (let i = 0; i < 220; i++) {
      const col = i % 22, row = (i / 22) | 0;
      const x = 40 + col * 54 + Math.sin(t + i) * 6;
      const y = 40 + row * 64 + Math.cos(t * 0.8 + i) * 6;
      cDrawRect(ctx, { x, y, w: 44, h: 50, color: palette[i % palette.length], opacity: 0.5, radius: 8 });
    }
    // Glow orbs (circles)
    for (let i = 0; i < 140; i++) {
      const a = t * 0.5 + i * 0.45;
      cDrawCircle(ctx, { x: 640 + Math.cos(a) * (120 + i), y: 360 + Math.sin(a) * (70 + i * 0.4), radius: 4 + (i % 7), color: palette[i % palette.length], opacity: 0.65 });
    }
    // Connective lines
    for (let i = 0; i < 40; i++) {
      const a = t + i;
      cDrawLine(ctx, { p1: { x: 100 + i * 28, y: 360 + Math.sin(a) * 120 }, p2: { x: 120 + i * 28, y: 360 - Math.cos(a) * 120 }, width: 2, color: [70, 230, 198], opacity: 0.4 });
    }
    // Labels (text)
    for (let i = 0; i < 40; i++) {
      cDrawText(ctx, { text: "Tamer " + i, x: 60 + (i % 8) * 150, y: 600 + ((i / 8) | 0) * 22, size: 16, color: [240, 243, 244], opacity: 0.9 });
    }
    // Frame meter overlay
    const s = window.__tqCanvasStats || { fps: 0, ms: 0 };
    cDrawRect(ctx, { x: 8, y: 8, w: 250, h: 34, color: [0, 0, 0], opacity: 0.55, radius: 6 });
    cDrawText(ctx, { text: `canvas2D backend — ${s.fps} fps / ${s.ms} ms`, x: 18, y: 16, size: 18, color: [70, 230, 198] });
  });
}
