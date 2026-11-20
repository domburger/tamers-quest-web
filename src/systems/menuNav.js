import { BTN } from "./gamepad.js";

const DPAD_UP = 12, DPAD_DOWN = 13, DPAD_LEFT = 14, DPAD_RIGHT = 15;

export function makeMenuNav({ wrap = true } = {}) {
  let items = [];
  let focus = 0;
  let onBack = null;

  const clamp = () => { if (focus < 0) focus = 0; else if (focus >= items.length) focus = Math.max(0, items.length - 1); };

  const api = {
    setItems(list, o = {}) {
      const prevId = "keepId" in o ? o.keepId : items[focus] && items[focus].id;
      items = Array.isArray(list) ? list.slice() : [];
      const i = items.findIndex((it) => it && it.id === prevId);
      focus = i >= 0 ? i : Math.min(focus, items.length - 1);
      clamp();
      return api;
    },
    setOnBack(fn) { onBack = fn; return api; },
    count() { return items.length; },
    index() { return items.length ? focus : -1; },
    focusId() { return items.length ? items[focus].id : null; },
    move(delta) {
      if (!items.length) return api;
      focus += delta;
      if (wrap) focus = ((focus % items.length) + items.length) % items.length;
      else clamp();
      return api;
    },
    activate() { const it = items[focus]; if (it && typeof it.onActivate === "function") { it.onActivate(); return true; } return false; },
    back() { if (typeof onBack === "function") { onBack(); return true; } return false; },
    handleGamepad(pressed) {
      if (!pressed || !items.length) return null;
      if (pressed.has(DPAD_UP) || pressed.has(DPAD_LEFT)) { api.move(-1); return "move"; }
      if (pressed.has(DPAD_DOWN) || pressed.has(DPAD_RIGHT)) { api.move(1); return "move"; }
      if (pressed.has(BTN.A)) { return api.activate() ? "activate" : null; }
      if (pressed.has(BTN.B)) { return api.back() ? "back" : null; }
      return null;
    },
  };
  return api;
}
