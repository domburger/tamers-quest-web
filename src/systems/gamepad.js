const DEAD = 0.28;

const pads = () =>
  typeof navigator !== "undefined" && navigator.getGamepads
    ? [...navigator.getGamepads()].filter(Boolean)
    : [];
const firstPad = () => pads()[0] || null;

export function gamepadConnected() { return pads().length > 0; }

export function applyDeadzone(v, dz = DEAD) { return Math.abs(v) < dz ? 0 : v; }

export function gamepadMove() {
  const g = firstPad();
  if (!g) return { x: 0, y: 0 };
  let x = applyDeadzone(g.axes[0] || 0);
  let y = applyDeadzone(g.axes[1] || 0);
  const b = g.buttons || [];
  if (b[14] && b[14].pressed) x = -1;
  if (b[15] && b[15].pressed) x = 1;
  if (b[12] && b[12].pressed) y = -1;
  if (b[13] && b[13].pressed) y = 1;
  return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
}

// Call exactly once per frame (edge detection).
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

export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, START: 9 };
