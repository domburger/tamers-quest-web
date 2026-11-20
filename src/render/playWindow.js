let _pwW = NaN, _pwH = NaN, _pwA = NaN, _pwR = null;
export function playWindowRect(W, H, { margin = 0, maxAspect = 1 } = {}) {
  if (margin === 0 && W === _pwW && H === _pwH && maxAspect === _pwA) return _pwR;
  const short = Math.max(0, Math.min(W, H) - margin * 2);
  const longCap = short * Math.max(1, maxAspect);
  let w, h;
  if (W >= H) { h = short; w = Math.min(Math.max(0, W - margin * 2), longCap); }
  else { w = short; h = Math.min(Math.max(0, H - margin * 2), longCap); }
  const x = Math.round((W - w) / 2);
  const y = Math.round((H - h) / 2);
  const r = { x, y, w, h, size: Math.min(w, h), cx: x + w / 2, cy: y + h / 2, right: x + w, bottom: y + h };
  if (margin === 0) { _pwW = W; _pwH = H; _pwA = maxAspect; _pwR = Object.freeze(r); }
  return r;
}

export function playWindowLayout(W, H, { margin = 0, maxAspect = 1 } = {}) {
  const square = playWindowRect(W, H, { margin, maxAspect });
  const left = { x: 0, y: 0, w: square.x, h: H };
  const right = { x: square.right, y: 0, w: Math.max(0, W - square.right), h: H };
  const top = { x: 0, y: 0, w: W, h: square.y };
  const bottom = { x: 0, y: square.bottom, w: W, h: Math.max(0, H - square.bottom) };
  return {
    square, left, right, top, bottom,
    landscape: square.x > 0,
    portrait: square.y > 0,
  };
}

export function drawPlayWindow(k, { margin = 0, maxAspect = 1, bezel = [10, 11, 16] } = {}) {
  const W = k.width(), H = k.height();
  const r = playWindowRect(W, H, { margin, maxAspect });
  const col = k.rgb(bezel[0], bezel[1], bezel[2]);
  const band = (x, y, w, h) => { if (w > 0 && h > 0) k.drawRect({ pos: k.vec2(x, y), width: w, height: h, color: col, opacity: 1, fixed: true }); };
  band(0, 0, r.x, H);
  band(r.right, 0, W - r.right, H);
  band(0, 0, W, r.y);
  band(0, r.bottom, W, H - r.bottom);
  return r;
}
