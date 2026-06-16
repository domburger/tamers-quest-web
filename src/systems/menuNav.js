// TQ-525: shared controller focus-navigation for the out-of-round menus (follow-up to TQ-459, which made
// in-round play fully controller-operable). A scene registers an ORDERED list of focusable items
// (each `{ id, onActivate }`); the d-pad cycles focus in that tab order, A activates the focused item, and
// B invokes the scene's back handler. Pure + framework-free (no canvas / DOM / Phaser) so it's unit-testable
// and reusable across charselect, the lobby picker, and the hub-station popups.
//
// Usage per frame (only while a pad is connected — gamepadConnected()):
//   nav.setItems([{ id: "enter", onActivate: enterCaves }, ...]);  // re-supplied each frame; focus sticks to its id
//   nav.handleGamepad(gamepadPressed());                            // d-pad → move, A → activate, B → back
//   drawFocusRing(nav.focusId());                                   // the scene draws the ring; pointer/touch unchanged
//
// Pointer/touch input is a fully parallel path — this never disables it.

import { BTN } from "./gamepad.js";

// Standard Gamepad d-pad button indices (gamepadPressed() edge-detects all buttons, including these).
const DPAD_UP = 12, DPAD_DOWN = 13, DPAD_LEFT = 14, DPAD_RIGHT = 15;

/**
 * @param {{wrap?:boolean}} [opts] wrap=true (default) cycles past the ends; false clamps.
 */
export function makeMenuNav({ wrap = true } = {}) {
  let items = [];     // [{ id, onActivate }]
  let focus = 0;
  let onBack = null;

  const clamp = () => { if (focus < 0) focus = 0; else if (focus >= items.length) focus = Math.max(0, items.length - 1); };

  const api = {
    /**
     * Replace the focusable list (call each frame — it's cheap). Focus STICKS to the same item id across
     * re-supplies so a redraw/relayout doesn't jump the cursor; if that id is gone, focus clamps into range.
     * @param {Array<{id:*, onActivate?:Function}>} list
     * @param {{keepId?:*}} [o] override which id to preserve focus on (default: the currently-focused id)
     */
    setItems(list, o = {}) {
      const prevId = "keepId" in o ? o.keepId : items[focus] && items[focus].id;
      items = Array.isArray(list) ? list.slice() : [];
      const i = items.findIndex((it) => it && it.id === prevId);
      focus = i >= 0 ? i : Math.min(focus, items.length - 1);
      clamp();
      return api;
    },
    /** Set the handler invoked on B / back. */
    setOnBack(fn) { onBack = fn; return api; },
    count() { return items.length; },
    /** Current focus index, or -1 when there are no items. */
    index() { return items.length ? focus : -1; },
    /** Id of the focused item, or null when empty. The scene draws its focus ring around this. */
    focusId() { return items.length ? items[focus].id : null; },
    /** Move focus to a specific id (no-op if absent). */
    focusById(id) { const i = items.findIndex((it) => it && it.id === id); if (i >= 0) focus = i; return api; },
    /** Step focus by `delta` (negative = previous). Wraps or clamps per the constructor option. */
    move(delta) {
      if (!items.length) return api;
      focus += delta;
      if (wrap) focus = ((focus % items.length) + items.length) % items.length;
      else clamp();
      return api;
    },
    /** Fire the focused item's onActivate. @returns {boolean} true if something was activated. */
    activate() { const it = items[focus]; if (it && typeof it.onActivate === "function") { it.onActivate(); return true; } return false; },
    /** Invoke the back handler. @returns {boolean} true if a handler ran. */
    back() { if (typeof onBack === "function") { onBack(); return true; } return false; },
    /**
     * Apply one frame of gamepad input. Up/Left = previous, Down/Right = next (linear tab order); A activates,
     * B backs. Movement takes priority over A/B in the rare same-frame case.
     * @param {Set<number>} pressed the edge set from gamepadPressed() (call it once per frame)
     * @returns {"move"|"activate"|"back"|null} the action taken
     */
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
