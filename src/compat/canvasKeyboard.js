// TQ-280 (Phase 4, engine-removal TQ-227/231): keyboard input for the canvas backend via DOM listeners,
// matching the shim's k.isKeyDown/onKeyPress/onKeyDown/onCharInput (kaboomShim.js). Scenes use kaboom key
// NAMES (up/down/left/right/space/enter/escape/backspace/tab/shift/[/] + letters/digits); this maps both
// the names AND the DOM KeyboardEvent.key to one canonical token so they compare. No Phaser, no canvas.

// kaboom key NAME -> canonical token.
const NAME_TO_TOKEN = {
  up: "up", down: "down", left: "left", right: "right",
  space: "space", enter: "enter", escape: "escape", esc: "escape",
  backspace: "backspace", tab: "tab", shift: "shift",
};
/** Normalize a kaboom key name (what scenes pass to isKeyDown/onKeyPress) to the canonical token. Pure. */
export function normalizeKeyName(name) {
  const n = String(name == null ? "" : name).toLowerCase();
  if (NAME_TO_TOKEN[n]) return NAME_TO_TOKEN[n];
  return n; // "[" / "]" / single letters / digits map to themselves; unknown names compare by themselves
}

// DOM KeyboardEvent.key -> canonical token (named keys; single chars fall through lowercased).
const DOM_KEY_TO_TOKEN = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  " ": "space", Spacebar: "space", Enter: "enter", Escape: "escape", Esc: "escape",
  Backspace: "backspace", Tab: "tab", Shift: "shift",
};
/** Map a DOM keyboard event to the canonical token, or null for an untracked key (Control/Alt/F-keys). Pure. */
export function domKeyToken(e) {
  if (!e || e.key == null) return null;
  const k = e.key;
  if (DOM_KEY_TO_TOKEN[k]) return DOM_KEY_TO_TOKEN[k];
  if (k.length === 1) return k.toLowerCase(); // letters / digits / [ ] / punctuation
  return null;                                 // multi-char names we don't track (e.g. "Control", "F1")
}

const add = (map, key, cb) => { let s = map.get(key); if (!s) map.set(key, (s = new Set())); s.add(cb); };
const del = (map, key, cb) => { const s = map.get(key); if (s) s.delete(cb); };

/**
 * Keyboard input over DOM listeners, mirroring the shim surface. `target` defaults to window (pass a mock
 * EventTarget in tests). Call update() once per frame to fire continuous onKeyDown handlers. dispose()
 * detaches everything.
 * @param {EventTarget} [target]
 */
export function makeKeyboard(target = (typeof window !== "undefined" ? window : null)) {
  const held = new Set();
  const press = new Map();  // token -> Set<cb>  (down EDGE; ignores auto-repeat)
  const down = new Map();   // token -> Set<cb>  (continuous; fired from update())
  const chars = new Set();  // cb(char)

  const onKeydown = (e) => {
    // char input: a printable single char with no command modifiers (repeat is allowed, like typing).
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key && e.key.length === 1) for (const cb of chars) cb(e.key);
    const tok = domKeyToken(e);
    if (!tok) return;
    if (!e.repeat && !held.has(tok)) for (const cb of press.get(tok) || []) cb(); // down edge only
    held.add(tok);
  };
  const onKeyup = (e) => { const tok = domKeyToken(e); if (tok) held.delete(tok); };
  const onBlur = () => held.clear(); // lost focus → release all so keys don't stick

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
    /** Fire continuous onKeyDown handlers for every currently-held key — call once per frame. */
    update() { for (const tok of held) for (const cb of down.get(tok) || []) cb(); },
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
