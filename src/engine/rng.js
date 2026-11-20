export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const numeric = typeof seed === "string" ? hashString(seed) : seed >>> 0;
  const next = mulberry32(numeric);
  return {
    seed: numeric,
    next,
    float: (a = 0, b = 1) => a + next() * (b - a),
    int: (a, b) => Math.floor(a + next() * (b - a + 1)), // inclusive [a, b]
    range: (n) => Math.floor(next() * n),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

export function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}
