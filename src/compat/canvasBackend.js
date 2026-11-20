const DESIGN_W = 1280, DESIGN_H = 720;


export function designWidthFor(winW, winH, designH = DESIGN_H) {
  const ww = Math.max(1, winW || 0), wh = Math.max(1, winH || 0);
  return Math.round(Math.max(240, Math.min(5120, designH * (ww / wh))));
}

export function viewport(winW, winH, designH = DESIGN_H) {
  return { W: designWidthFor(winW, winH, designH), H: designH, scale: Math.max(1, winH || 0) / designH };
}

export function pointerToDesign(clientX, clientY, rect, designH = DESIGN_H) {
  const r = rect || {};
  const scale = Math.max(1, r.height || designH) / designH;
  return { x: (clientX - (r.left || 0)) / scale, y: (clientY - (r.top || 0)) / scale };
}

const rgba = (c, o = 1) =>
  c && typeof c.r === "number" ? `rgba(${c.r | 0},${c.g | 0},${c.b | 0},${o})`
    : Array.isArray(c) ? `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${o})`
      : `rgba(255,255,255,${o})`;

// Shadow-guarded: only cDraw* may set fillStyle/strokeStyle on the live ctx.
function setFill(ctx, s, st) { if (st) { if (st.fill !== s) { ctx.fillStyle = s; st.fill = s; } } else ctx.fillStyle = s; }
function setStroke(ctx, s, st) { if (st) { if (st.stroke !== s) { ctx.strokeStyle = s; st.stroke = s; } } else ctx.strokeStyle = s; }

function traceRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeGradient(ctx, g, x, y, w, h, opacity) {
  let grad;
  if (g.dir === "radial") {
    const cx = x + w * (g.cx ?? 0.5), cy = y + h * (g.cy ?? 0.5), r = g.r ?? Math.hypot(w, h) / 2;
    grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(0.1, r));
  } else if (g.dir === "h") grad = ctx.createLinearGradient(x, y, x + w, y);
  else grad = ctx.createLinearGradient(x, y, x, y + h);
  for (const s of g.stops || []) grad.addColorStop(Math.min(1, Math.max(0, s[0])), rgba(s[1], (s[2] ?? 1) * opacity));
  return grad;
}
function beginShadow(ctx, s, opacity) {
  ctx.shadowColor = rgba(s.color || [0, 0, 0], (s.alpha ?? 0.5) * opacity);
  ctx.shadowBlur = s.blur || 0;
  ctx.shadowOffsetX = s.dx || 0;
  ctx.shadowOffsetY = s.dy || 0;
}
function endShadow(ctx) { ctx.shadowColor = "rgba(0,0,0,0)"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }

export function cDrawRect(ctx, { x = 0, y = 0, w = 0, h = 0, color = [255, 255, 255], opacity = 1, radius = 0, fill = true, outline = null, gradient = null, shadow = null } = {}, style = null) {
  const r = radius > 0 ? Math.min(radius, w / 2, h / 2) : 0;
  if (fill !== false) {
    if (gradient) { ctx.fillStyle = makeGradient(ctx, gradient, x, y, w, h, opacity); if (style) style.fill = null; }
    else setFill(ctx, rgba(color, opacity), style);
    if (shadow) beginShadow(ctx, shadow, opacity);
    if (r) { traceRoundRect(ctx, x, y, w, h, r); ctx.fill(); } else ctx.fillRect(x, y, w, h);
    if (shadow) endShadow(ctx);
  }
  if (outline) {
    setStroke(ctx, rgba(outline.color || color, opacity), style);
    ctx.lineWidth = Math.max(0.1, outline.width || 1);
    if (r) { traceRoundRect(ctx, x, y, w, h, r); ctx.stroke(); } else ctx.strokeRect(x, y, w, h);
  }
}

export function cDrawCircle(ctx, { x = 0, y = 0, radius = 1, color = [255, 255, 255], opacity = 1, fill = true, outline = null, gradient = null } = {}, style = null) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, radius), 0, Math.PI * 2);
  if (fill !== false) {
    if (gradient) { ctx.fillStyle = makeGradient(ctx, { dir: "radial", r: radius, ...gradient }, x - radius, y - radius, radius * 2, radius * 2, opacity); if (style) style.fill = null; }
    else setFill(ctx, rgba(color, opacity), style);
    ctx.fill();
  }
  if (outline) {
    setStroke(ctx, rgba(outline.color || color, opacity), style);
    ctx.lineWidth = Math.max(0.1, outline.width || 1);
    ctx.stroke();
  }
}

export function cDrawEllipse(ctx, { x = 0, y = 0, radiusX = 1, radiusY = 1, color = [255, 255, 255], opacity = 1, gradient = null } = {}, style = null) {
  if (gradient && radiusX > 0 && radiusY > 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, radiusY / radiusX);
    ctx.fillStyle = makeGradient(ctx, { dir: "radial", r: radiusX, ...gradient }, -radiusX, -radiusX, radiusX * 2, radiusX * 2, opacity);
    if (style) style.fill = null;
    ctx.beginPath();
    ctx.arc(0, 0, radiusX, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
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

export function textBaselineFor(anchor) { return anchor.includes("center") ? "middle" : "top"; }
export function textAlignFor(anchor) { return anchor === "center" || anchor === "top" || anchor === "bot" ? "center" : anchor.includes("right") ? "right" : "left"; }

export function cDrawText(ctx, { text = "", x = 0, y = 0, size = 16, color = [255, 255, 255], opacity = 1, anchor = "topleft", font = "sans-serif", width = 0, lineHeight = 0 } = {}, state = null) {
  setFill(ctx, rgba(color, opacity), state);
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

export function makeCanvasRuntime(draw, { mount, onPointer, hideTitle = true, zIndex = "99999" } = {}) {
  const canvas = document.createElement("canvas");
  canvas.id = "tq-canvas-backend";
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", zIndex, background: "#12141b", display: "block" });
  (mount || document.body).appendChild(canvas);
  if (hideTitle) { try { const ttl = document.getElementById("title"); if (ttl) { ttl.style.display = "none"; } } catch {} }
  const ctx = canvas.getContext("2d");

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
    // Assigning canvas size clears it; resize() runs repeatedly, keep it a no-op.
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const vp = viewport(winW, winH);
    canvas._tq = { dpr, vp };
    stats.designW = vp.W;
  };
  resize();
  // iOS standalone PWA reports stale size mid-rotation; re-run resize after settle.
  const resettle = () => {
    resize();
    try { requestAnimationFrame(resize); } catch {}
    try { setTimeout(resize, 250); setTimeout(resize, 550); } catch {}
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
    ctx.setTransform(vp.scale * dpr, 0, 0, vp.scale * dpr, 0, 0);
    try { draw(ctx, (now - t0) / 1000, dt / 1000, stats); } catch (e) { void e; }
    ctx.restore();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);


  const frost = { canvas: null, ready: false };
  const captureFrost = () => {
    try {
      const S = 6, fw = Math.max(8, Math.round(canvas.width / S)), fh = Math.max(8, Math.round(canvas.height / S));
      if (!frost.canvas) frost.canvas = document.createElement("canvas");
      const fc = frost.canvas;
      if (fc.width !== fw) fc.width = fw;
      if (fc.height !== fh) fc.height = fh;
      const fx = fc.getContext("2d");
      fx.setTransform(1, 0, 0, 1, 0, 0);
      fx.filter = "none";
      fx.fillStyle = "#0C0C0D"; fx.fillRect(0, 0, fw, fh);
      fx.drawImage(canvas, 0, 0, fw, fh);
      try { fx.filter = "blur(3px)"; fx.drawImage(fc, 0, 0); fx.drawImage(fc, 0, 0); } catch {}
      fx.filter = "none";
      frost.ready = true;
    } catch { frost.ready = false; }
  };
  return { canvas, stats, resize, frost, captureFrost, stop() {
    try { cancelAnimationFrame(raf); } catch {}
    for (const [type, h] of pointerHandlers) { try { canvas.removeEventListener(type, h); } catch {} }
    try { canvas.remove(); } catch {}
  } };
}

