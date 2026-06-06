// Controller / gamepad input (user-requested). Browser Gamepad API, polled each
// frame. Pure input only — the scene maps it to actions (movement, combat, throw),
// reusing the same handlers as keyboard. No Kaboom/Phaser/shim dependency.
// Node-safe (returns neutral when navigator/gamepads are unavailable) so it imports
// cleanly in tests. Standard-mapping bindings the scene applies:
//   left stick / d-pad = move · A/B/X/Y = attack 1-4 (A = throw chain when roaming)
//   LB = catch · RB = flee
const DEAD = 0.28;

const pads = () =>
  typeof navigator !== "undefined" && navigator.getGamepads
    ? [...navigator.getGamepads()].filter(Boolean)
    : [];
const firstPad = () => pads()[0] || null;

export function gamepadConnected() { return pads().length > 0; }

// Zero out small stick values (drift); pass through larger magnitudes.
export function applyDeadzone(v, dz = DEAD) { return Math.abs(v) < dz ? 0 : v; }

// Normalized move vector from left stick + d-pad. {x:0,y:0} when no pad / neutral.
export function gamepadMove() {
  const g = firstPad();
  if (!g) return { x: 0, y: 0 };
  let x = applyDeadzone(g.axes[0] || 0);
  let y = applyDeadzone(g.axes[1] || 0);
  const b = g.buttons || [];
  if (b[14] && b[14].pressed) x = -1; // d-pad left
  if (b[15] && b[15].pressed) x = 1;  // d-pad right
  if (b[12] && b[12].pressed) y = -1; // d-pad up
  if (b[13] && b[13].pressed) y = 1;  // d-pad down
  return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
}

// Edge detection: the set of button indices that went up→down since the last call.
// Call exactly once per frame.
let prev = [];
export function gamepadPressed() {
  const g = firstPad();
  const edges = new Set();
  if (!g) { prev = []; return edges; }
  const b = g.buttons || [];
  for (let i = 0; i < b.length; i++) {
    const down = !!(b[i] && b[i].pressed);
    if (down && !prev[i]) edges.add(i);
    prev[i] = down;
  }
  return edges;
}

// Standard Gamepad button indices.
export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, START: 9 };
