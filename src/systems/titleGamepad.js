// TQ-525: controller navigation for the HTML title screen (#title) — a pad-only player can pick guest /
// login / "Enter as <name>" and operate the sign-in modals without a mouse. The title is plain DOM (not a
// canvas scene), so this is a small focus loop that REUSES the shared menuNav focus model: each frame it
// collects the visible, enabled buttons of the active context (an open .guest-modal, else the title
// actions), lets the d-pad cycle focus, A .click()s the focused button, and B cancels an open modal.
//
// Safe by construction: it does NOTHING unless a gamepad is connected AND the title is visible, it uses
// native .click()/focus and an inline outline (no CSS/index.html dependency), and pointer/touch/keyboard
// stay fully parallel. The focus-model logic lives in menuNav (unit-tested); the DOM glue here is testable
// via the returned step() with an injected doc + pressed-set.

import { makeMenuNav } from "./menuNav.js";
import { gamepadPressed, gamepadConnected } from "./gamepad.js";

const FOCUS_OUTLINE = "3px solid #f0533d"; // primary accent; visible on the dark title

/**
 * @param {{doc?:Document, readPressed?:()=>Set<number>, isConnected?:()=>boolean,
 *          schedule?:(fn:Function)=>any, cancel?:(h:any)=>void}} [deps] all injectable for tests
 * @returns {{ step:Function, stop:Function }}
 */
export function initTitleGamepad(deps = {}) {
  const doc = deps.doc || (typeof document !== "undefined" ? document : null);
  const readPressed = deps.readPressed || gamepadPressed;
  const isConnected = deps.isConnected || gamepadConnected;
  const schedule = deps.schedule || (typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame : null);
  const cancel = deps.cancel || (typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame : null);
  const noop = { step() {}, stop() {} };
  if (!doc) return noop;
  const title = doc.getElementById("title");
  if (!title) return noop;

  const nav = makeMenuNav();
  let focusedEl = null;

  // Title is hidden (launch adds .hidden) → don't drive nav. getComputedStyle guards the stay-logged-in
  // display:none too; fall back to the class check in non-browser/test docs.
  const titleVisible = () => {
    if (title.classList && title.classList.contains("hidden")) return false;
    try { if (doc.defaultView && doc.defaultView.getComputedStyle(title).display === "none") return false; } catch { /* test doc */ }
    return true;
  };
  // A visible, enabled button is focusable. offsetParent === null filters display:none (the .signed-in /
  // .resuming toggles + the hidden modals), so we never focus an off-screen control.
  const focusables = (root) => Array.from(root.querySelectorAll("button")).filter((b) => b.offsetParent !== null && !b.disabled);

  const highlight = (el) => {
    if (focusedEl === el) return;
    if (focusedEl) { try { focusedEl.style.outline = ""; focusedEl.style.outlineOffset = ""; } catch { /* gone */ } }
    focusedEl = el || null;
    if (focusedEl) {
      try { focusedEl.style.outline = FOCUS_OUTLINE; focusedEl.style.outlineOffset = "2px"; focusedEl.focus({ preventScroll: true }); } catch { /* gone */ }
    }
  };

  const step = () => {
    if (!isConnected() || !titleVisible()) { highlight(null); return; }
    // When a modal is open its buttons sit OVER the title actions — restrict focus to it so we don't land on
    // a control hidden behind the overlay. All sign-in modals share the .guest-modal class.
    const modal = doc.querySelector(".guest-modal.show");
    const root = modal || title;
    const btns = focusables(root);
    if (!btns.length) { highlight(null); return; }
    // Preserve focus on the same element across frames; default to the first when focus is stale/absent.
    nav.setItems(btns.map((b) => ({ id: b, onActivate: () => b.click() })), { keepId: btns.includes(focusedEl) ? focusedEl : undefined });
    nav.setOnBack(() => { const c = root.querySelector('[id$="-cancel"]'); if (c) c.click(); });
    nav.handleGamepad(readPressed());
    highlight(nav.focusId());
  };

  let raf = 0;
  const loop = () => { raf = schedule ? schedule(loop) : 0; step(); };
  if (schedule) raf = schedule(loop);

  return {
    step,
    stop() { try { if (cancel && raf) cancel(raf); } catch { /* ok */ } highlight(null); },
  };
}
