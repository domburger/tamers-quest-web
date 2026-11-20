export const RECONCILE = {
  SNAP_PX: 220,
  DEADZONE_PX: 4,
  RATE: 8,
  ALONG_BEHIND_PX: 10,
  ALONG_AHEAD_S: 0.12,
  ALONG_AHEAD_PAD: 6,
};

export function takeAcked(hist, ack) {
  if (!ack || !hist.length) return null;
  let i = hist.length - 1;
  while (i >= 0 && hist[i].seq > ack) i--;
  if (i < 0 || hist[i].seq !== ack) return null;
  if (i > 0) hist.splice(0, i);
  return hist[0];
}

// Shift hist by each correction, else the same error is re-applied every frame.
export function reconcileStep(pos, server, h, hist, dt, maxSpeed, cfg = RECONCILE) {
  let gx = server.x - h.x, gy = server.y - h.y;
  const hl = Math.hypot(h.dx, h.dy);
  if (hl > 0) {
    const ux = h.dx / hl, uy = h.dy / hl;
    const along = gx * ux + gy * uy;
    const legit = Math.max(-cfg.ALONG_BEHIND_PX, Math.min(maxSpeed * cfg.ALONG_AHEAD_S + cfg.ALONG_AHEAD_PAD, along));
    gx -= legit * ux; gy -= legit * uy;
  }
  const d = Math.hypot(gx, gy);
  if (d > cfg.SNAP_PX) { pos.x = server.x; pos.y = server.y; hist.length = 0; return "snap"; }
  if (d <= cfg.DEADZONE_PX) return "none";
  const rate = Math.min(1, dt * cfg.RATE), cx = gx * rate, cy = gy * rate;
  pos.x += cx; pos.y += cy;
  for (const e of hist) { e.x += cx; e.y += cy; }
  return "correct";
}
