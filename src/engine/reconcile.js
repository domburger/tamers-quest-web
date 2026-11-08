// ACK-based reconciliation of the locally predicted player position (MP client prediction). Pure + framework-
// free so it is unit-testable; onlineGame.js calls it every frame.
//
// The client records where its prediction was when each move input went out (`hist`: { seq, x, y, dx, dy }).
// A snapshot's `ack` names the last input the server applied, so the server position is compared with OUR
// position at that same input, not with "now". The legitimate prediction lead (including the lead along the
// PREVIOUS heading right after a turn) is already inside the history, so a turn never reads as an error. The
// old current-direction lead estimate yanked the player back along the old heading on every turn under lag.

export const RECONCILE = {
  SNAP_PX: 220,        // divergence beyond this is a teleport / respawn / region travel: snap and drop history
  DEADZONE_PX: 4,      // below this, leave the prediction alone (no micro-corrections)
  RATE: 8,             // per-second correction rate (frame-rate independent: min(1, dt * RATE))
  ALONG_BEHIND_PX: 10, // the server may be up to a tick BEHIND along the acked input's direction
  ALONG_AHEAD_S: 0.12, // ... and up to one input interval + a tick AHEAD of where we were when we sent it
  ALONG_AHEAD_PAD: 6,
};

/**
 * Find the history entry for `ack`, dropping older entries (they can never be acked again). Returns the
 * entry or null (no ack yet / not in the window). Mutates `hist`.
 */
export function takeAcked(hist, ack) {
  if (!ack || !hist.length) return null;
  let i = hist.length - 1;
  while (i >= 0 && hist[i].seq > ack) i--;
  if (i < 0 || hist[i].seq !== ack) return null;
  if (i > 0) hist.splice(0, i);
  return hist[0];
}

/**
 * One reconciliation step. `pos` is the predicted render position (mutated), `server` the authoritative
 * snapshot position, `h` the acked history entry, `maxSpeed` the fastest legal speed (px/s, sprint).
 * Removes the movement the server may legitimately have applied for the acked input since it arrived, then
 * corrects what remains toward the server at RATE and SHIFTS the history by the same amount, so the next
 * frames see the reduced error (re-applying one snapshot's error every frame would overshoot).
 * Returns "snap" | "correct" | "none".
 */
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
