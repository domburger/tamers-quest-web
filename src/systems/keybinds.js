// Keys are canvas-shim names (k.isKeyDown), not DOM e.key values.

const LS_KEY = "tq_keybinds";

export const DEFAULT_BINDINGS = Object.freeze({
  moveUp: ["w", "up"],
  moveDown: ["s", "down"],
  moveLeft: ["a", "left"],
  moveRight: ["d", "right"],
  sprint: ["shift"],
  throw: ["space"],
  chainNext: ["q", "]"],
  chainPrev: ["["],
  attack1: ["1"],
  attack2: ["2"],
  attack3: ["3"],
  attack4: ["4"],
  catch: ["c"],
  flee: ["f"],
  swap: ["x"],
  pause: ["escape"],
  mute: ["m"],
});

export const ACTION_META = Object.freeze([
  { action: "moveUp", label: "Move up" },
  { action: "moveDown", label: "Move down" },
  { action: "moveLeft", label: "Move left" },
  { action: "moveRight", label: "Move right" },
  { action: "sprint", label: "Sprint" },
  { action: "throw", label: "Throw spirit chain" },
  { action: "chainNext", label: "Next chain" },
  { action: "chainPrev", label: "Previous chain" },
  { action: "attack1", label: "Combat: attack 1" },
  { action: "attack2", label: "Combat: attack 2" },
  { action: "attack3", label: "Combat: attack 3" },
  { action: "attack4", label: "Combat: attack 4" },
  { action: "catch", label: "Combat: catch" },
  { action: "flee", label: "Combat: flee" },
  { action: "swap", label: "Combat: swap monster" },
  { action: "pause", label: "Pause / menu" },
  { action: "mute", label: "Mute audio" },
]);

export const ACTIONS = Object.freeze(Object.keys(DEFAULT_BINDINGS));
const isAction = (a) => Object.prototype.hasOwnProperty.call(DEFAULT_BINDINGS, a);

function defaultStore() {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

export function normalizeKey(key) {
  if (typeof key !== "string") return "";
  const k = key.trim().toLowerCase();
  return k;
}

export function loadOverrides(store = defaultStore()) {
  if (!store) return {};
  let raw;
  try { raw = store.getItem(LS_KEY); } catch { return {}; }
  if (!raw) return {};
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  if (!parsed || typeof parsed !== "object") return {};
  const out = {};
  for (const a of ACTIONS) {
    const v = parsed[a];
    if (!Array.isArray(v)) continue;
    const keys = v.map(normalizeKey).filter(Boolean);
    if (keys.length) out[a] = [...new Set(keys)];
  }
  return out;
}

export function getBindings(store = defaultStore()) {
  const ov = loadOverrides(store);
  const out = {};
  for (const a of ACTIONS) out[a] = ov[a] ? [...ov[a]] : [...DEFAULT_BINDINGS[a]];
  return out;
}

export function keysFor(action, store = defaultStore()) {
  if (!isAction(action)) return [];
  const ov = loadOverrides(store);
  return ov[action] ? [...ov[action]] : [...DEFAULT_BINDINGS[action]];
}

export function setBinding(action, keys, store = defaultStore()) {
  if (!isAction(action)) return [];
  const norm = (Array.isArray(keys) ? keys : [keys]).map(normalizeKey).filter(Boolean);
  const ov = loadOverrides(store);
  if (norm.length) ov[action] = [...new Set(norm)];
  else delete ov[action];
  if (store) { try { store.setItem(LS_KEY, JSON.stringify(ov)); } catch {} }
  return keysFor(action, store);
}

export function resetBinding(action, store = defaultStore()) {
  return setBinding(action, [], store);
}

export function resetAllBindings(store = defaultStore()) {
  if (store) { try { store.removeItem(LS_KEY); } catch {} }
}



export function actionsForKey(key, store = defaultStore()) {
  const want = normalizeKey(key);
  if (!want) return [];
  const b = getBindings(store);
  return ACTIONS.filter((a) => b[a].includes(want));
}
