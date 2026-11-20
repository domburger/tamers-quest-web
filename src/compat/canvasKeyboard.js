const NAME_TO_TOKEN = {
  up: "up", down: "down", left: "left", right: "right",
  space: "space", enter: "enter", escape: "escape", esc: "escape",
  backspace: "backspace", tab: "tab", shift: "shift",
};
export function normalizeKeyName(name) {
  const n = String(name == null ? "" : name).toLowerCase();
  if (NAME_TO_TOKEN[n]) return NAME_TO_TOKEN[n];
  return n;
}

const DOM_KEY_TO_TOKEN = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  " ": "space", Spacebar: "space", Enter: "enter", Escape: "escape", Esc: "escape",
  Backspace: "backspace", Tab: "tab", Shift: "shift",
};
export function domKeyToken(e) {
  if (!e || e.key == null) return null;
  const k = e.key;
  if (DOM_KEY_TO_TOKEN[k]) return DOM_KEY_TO_TOKEN[k];
  if (k.length === 1) return k.toLowerCase();
  return null;
}

const add = (map, key, cb) => { let s = map.get(key); if (!s) map.set(key, (s = new Set())); s.add(cb); };
const del = (map, key, cb) => { const s = map.get(key); if (s) s.delete(cb); };

export function makeKeyboard(target = (typeof window !== "undefined" ? window : null)) {
  const held = new Set();
  const press = new Map();
  const down = new Map();
  const chars = new Set();

  const onKeydown = (e) => {
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key && e.key.length === 1) for (const cb of chars) cb(e.key);
    const tok = domKeyToken(e);
    if (!tok) return;
    if (!e.repeat && !held.has(tok)) for (const cb of press.get(tok) || []) cb();
    held.add(tok);
  };
  const onKeyup = (e) => { const tok = domKeyToken(e); if (tok) held.delete(tok); };
  const onBlur = () => held.clear();

  if (target) {
    target.addEventListener("keydown", onKeydown);
    target.addEventListener("keyup", onKeyup);
    target.addEventListener("blur", onBlur);
  }

  return {
    isKeyDown(name) { return held.has(normalizeKeyName(name)); },
    onKeyPress(name, cb) { const t = normalizeKeyName(name); add(press, t, cb); return { cancel: () => del(press, t, cb) }; },
    onKeyDown(name, cb) { const t = normalizeKeyName(name); add(down, t, cb); return { cancel: () => del(down, t, cb) }; },
    onCharInput(cb) { chars.add(cb); return { cancel: () => chars.delete(cb) }; },
    update() { for (const tok of held) for (const cb of down.get(tok) || []) cb(); },
    // Must run on every scene go(): key handlers are scene-scoped.
    clearHandlers() { press.clear(); down.clear(); chars.clear(); },
    held: () => new Set(held),
    dispose() {
      if (target) {
        target.removeEventListener("keydown", onKeydown);
        target.removeEventListener("keyup", onKeyup);
        target.removeEventListener("blur", onBlur);
      }
      held.clear(); press.clear(); down.clear(); chars.clear();
    },
  };
}
