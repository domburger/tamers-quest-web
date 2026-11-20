import { makeMenuNav } from "./menuNav.js";
import { gamepadPressed, gamepadConnected } from "./gamepad.js";

const FOCUS_OUTLINE = "3px solid #f0533d";

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

  const titleVisible = () => {
    if (title.classList && title.classList.contains("hidden")) return false;
    try { if (doc.defaultView && doc.defaultView.getComputedStyle(title).display === "none") return false; } catch {}
    return true;
  };
  const focusables = (root) => Array.from(root.querySelectorAll("button")).filter((b) => b.offsetParent !== null && !b.disabled);

  const highlight = (el) => {
    if (focusedEl === el) return;
    if (focusedEl) { try { focusedEl.style.outline = ""; focusedEl.style.outlineOffset = ""; } catch {} }
    focusedEl = el || null;
    if (focusedEl) {
      try { focusedEl.style.outline = FOCUS_OUTLINE; focusedEl.style.outlineOffset = "2px"; focusedEl.focus({ preventScroll: true }); } catch {}
    }
  };

  const step = () => {
    if (!isConnected() || !titleVisible()) { highlight(null); return; }
    const modal = doc.querySelector(".guest-modal.show");
    const root = modal || title;
    const btns = focusables(root);
    if (!btns.length) { highlight(null); return; }
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
    stop() { try { if (cancel && raf) cancel(raf); } catch {} highlight(null); },
  };
}
