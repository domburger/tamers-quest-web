import { test } from "node:test";
import assert from "node:assert/strict";
import { takeAcked, reconcileStep, RECONCILE } from "./reconcile.js";

const SPEED = 200, SPRINT = 320, DT = 1 / 60;

test("takeAcked returns the acked entry and drops older ones; unknown acks return null", () => {
  const hist = [{ seq: 1 }, { seq: 2 }, { seq: 3 }, { seq: 4 }];
  assert.equal(takeAcked(hist, 0), null);
  assert.equal(takeAcked(hist, 9), null, "an ack that is not in the history matches nothing");
  assert.equal(hist.length, 4, "and leaves the history untouched");
});

test("takeAcked: exact match trims the history to start at the acked entry", () => {
  const hist = [{ seq: 1 }, { seq: 2 }, { seq: 3 }, { seq: 4 }];
  const h = takeAcked(hist, 3);
  assert.equal(h.seq, 3);
  assert.deepEqual(hist.map((e) => e.seq), [3, 4]);
});

// Simulate a walk with a TURN under lag: the client predicts instantly, the server applies each input LAG
// seconds later. With the history-based comparison, a turn must not produce any correction.
test("a 90-degree turn under 250ms lag produces no correction (the old heading's lead is in the history)", () => {
  const LAG = 0.25, SEND = 0.05;
  const inputs = []; // [time, dx, dy, seq]
  let seq = 0;
  for (let t = 0; t < 1; t += SEND) inputs.push([t, 1, 0, ++seq]);   // walk right for 1 s
  for (let t = 1; t < 2; t += SEND) inputs.push([t, 0, 1, ++seq]);   // then turn and walk down
  const pos = { x: 0, y: 0 }, server = { x: 0, y: 0 }, hist = [];
  let corrections = 0, maxCorr = 0, matched = 0;
  let iClient = 0, iServer = 0, srvDir = [0, 0], ack = 0;
  for (let t = 0; t < 2.2; t += DT) {
    // client: send inputs whose time has come, recording the predicted position at send time
    while (iClient < inputs.length && inputs[iClient][0] <= t) { const [, dx, dy, s] = inputs[iClient]; hist.push({ seq: s, x: pos.x, y: pos.y, dx, dy }); iClient++; }
    const cur = inputs[Math.max(0, iClient - 1)];
    if (t < 2) { pos.x += cur[1] * SPEED * DT; pos.y += cur[2] * SPEED * DT; }
    // server: apply inputs LAG later; it moves with the last applied input until the next one arrives
    while (iServer < inputs.length && inputs[iServer][0] + LAG <= t) { srvDir = [inputs[iServer][1], inputs[iServer][2]]; ack = inputs[iServer][3]; iServer++; }
    if (t < 2 + LAG) { server.x += srvDir[0] * SPEED * DT; server.y += srvDir[1] * SPEED * DT; }
    const h = takeAcked(hist, ack);
    if (h) {
      matched++;
      const before = { ...pos };
      const r = reconcileStep(pos, server, h, hist, DT, SPRINT);
      if (r === "correct") { corrections++; maxCorr = Math.max(maxCorr, Math.hypot(pos.x - before.x, pos.y - before.y)); }
      assert.notEqual(r, "snap", "a turn is never a teleport");
    }
  }
  assert.ok(matched > 60, `the acked history was actually compared on most frames (${matched})`);
  assert.ok(maxCorr < 1, `no visible correction on a turn (max per-frame correction ${maxCorr.toFixed(2)}px over ${corrections} frames)`);
});

test("a real divergence (server stopped by a wall the client missed) is corrected smoothly, without overshoot", () => {
  const pos = { x: 100, y: 0 }, server = { x: 60, y: 0 };
  // We sent a STOP at x=100, but the server's body was held at x=60 by a wall our prediction missed:
  // the acked entry says 100, the server says 60, so 40px of real disagreement remains.
  const hist = [{ seq: 5, x: 100, y: 0, dx: 0, dy: 0 }];
  let prevErr = Infinity;
  for (let i = 0; i < 120; i++) {
    const r = reconcileStep(pos, server, hist[0], hist, DT, SPRINT);
    const err = Math.abs(pos.x - server.x);
    assert.ok(err <= prevErr + 1e-9, "the error only shrinks (no overshoot)");
    assert.ok(pos.x >= server.x - 1e-9, "never crosses past the server position");
    prevErr = err;
    if (r === "none") break;
  }
  assert.ok(prevErr <= RECONCILE.DEADZONE_PX, `converges into the deadzone (left ${prevErr.toFixed(2)}px)`);
});

test("a teleport (respawn / region travel) snaps and clears the history", () => {
  const pos = { x: 0, y: 0 }, server = { x: 5000, y: 5000 };
  const hist = [{ seq: 1, x: 0, y: 0, dx: 1, dy: 0 }, { seq: 2, x: 3, y: 0, dx: 1, dy: 0 }];
  assert.equal(reconcileStep(pos, server, hist[0], hist, DT, SPRINT), "snap");
  assert.deepEqual(pos, { x: 5000, y: 5000 });
  assert.equal(hist.length, 0);
});

test("the server one input interval ahead along the acked direction is legitimate (no correction)", () => {
  const pos = { x: 200, y: 0 }, server = { x: 30, y: 0 }; // we sent at x=20 heading right; server is 10px further
  const hist = [{ seq: 7, x: 20, y: 0, dx: 1, dy: 0 }];
  assert.equal(reconcileStep(pos, server, hist[0], hist, DT, SPRINT), "none");
  assert.equal(pos.x, 200);
});
