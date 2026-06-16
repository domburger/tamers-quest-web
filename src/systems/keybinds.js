// Remappable keyboard controls (TQ-458). The single source of truth for which physical keys drive
// which gameplay ACTIONS, plus a small persistence layer so a player's overrides survive reloads.
//
// Why a module: the key literals were scattered across the scenes (movement via k.isKeyDown("w"…),
// actions via k.onKeyPress("c"…)). Centralising them here lets a Controls settings panel rebind them
// and lets every input site ask "is <action> down?" / "register a handler for <action>" instead of
// hard-coding a letter. Keys use the canvas-shim key names (lowercase letters, "up"/"down"/"left"/
// "right", "space", "escape", "shift", digit strings, "[" / "]") — the same strings k.isKeyDown /
// k.onKeyPress already expect, so wiring is a literal-for-binding swap with no shim change.
//
// Persistence mirrors a11y.js: a guarded localStorage read/write under one key, tolerant of disabled
// storage (private mode / SSR). The store is injectable so it's unit-testable without a real DOM.

const LS_KEY = "tq_keybinds";

// Default bindings — these REPRODUCE the pre-TQ-458 hard-coded keys exactly, so behaviour is
// unchanged until a player remaps. Each action maps to an ordered list of keys (any one triggers it).
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

// Human-readable labels + display order for the Controls settings panel.
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

// Normalise a key name to the shim's convention (lowercase; trim). Returns "" for junk so callers
// can drop it. Single printable keys + the named keys above all pass through lowercased.
export function normalizeKey(key) {
  if (typeof key !== "string") return "";
  const k = key.trim().toLowerCase();
  return k;
}

// Read the persisted overrides ({action: [keys]}), or {} when absent/disabled/corrupt. Only known
// actions with a non-empty array of valid key strings are kept (defensive against hand-edited storage).
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

// The active bindings: defaults with any persisted overrides applied per-action.
export function getBindings(store = defaultStore()) {
  const ov = loadOverrides(store);
  const out = {};
  for (const a of ACTIONS) out[a] = ov[a] ? [...ov[a]] : [...DEFAULT_BINDINGS[a]];
  return out;
}

// The keys currently bound to one action (override or default). Empty array for an unknown action.
export function keysFor(action, store = defaultStore()) {
  if (!isAction(action)) return [];
  const ov = loadOverrides(store);
  return ov[action] ? [...ov[action]] : [...DEFAULT_BINDINGS[action]];
}

// Persist an override for one action (an array of keys). Empty/cleared → revert that action to its
// default (override removed). Returns the resulting active key list. No-op-safe with storage disabled.
export function setBinding(action, keys, store = defaultStore()) {
  if (!isAction(action)) return [];
  const norm = (Array.isArray(keys) ? keys : [keys]).map(normalizeKey).filter(Boolean);
  const ov = loadOverrides(store);
  if (norm.length) ov[action] = [...new Set(norm)];
  else delete ov[action]; // empty → back to default
  if (store) { try { store.setItem(LS_KEY, JSON.stringify(ov)); } catch { /* storage disabled */ } }
  return keysFor(action, store);
}

// Revert one action to its default (drop its override).
export function resetBinding(action, store = defaultStore()) {
  return setBinding(action, [], store);
}

// Drop ALL overrides (every action back to default).
export function resetAllBindings(store = defaultStore()) {
  if (store) { try { store.removeItem(LS_KEY); } catch { /* ignore */ } }
}

// Is any key bound to `action` currently held down? Swap-in for `k.isKeyDown("w") || k.isKeyDown("up")`.
export function isActionDown(k, action, store = defaultStore()) {
  const keys = keysFor(action, store);
  for (const key of keys) { if (k.isKeyDown(key)) return true; }
  return false;
}

// Register `handler` for every key bound to `action` (swap-in for k.onKeyPress("c", handler)).
// Bindings are read once at registration (scene init); a remap applies on the next scene load —
// the same model menus/settings use. Returns the number of keys wired.
export function onAction(k, action, handler, store = defaultStore()) {
  const keys = keysFor(action, store);
  for (const key of keys) k.onKeyPress(key, handler);
  return keys.length;
}

// Which action(s) a given key is bound to (reverse lookup) — used by the rebind UI to warn on
// conflicts. Returns an array (a key could be bound to multiple actions, e.g. an accidental dup).
export function actionsForKey(key, store = defaultStore()) {
  const want = normalizeKey(key);
  if (!want) return [];
  const b = getBindings(store);
  return ACTIONS.filter((a) => b[a].includes(want));
}
