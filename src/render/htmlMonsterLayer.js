// SECURITY: assigns innerHTML; callers must pass sanitizeHtmlModel output only.

import { pickStateHtml } from "../systems/htmlModel.js";
import { ensureMonsterMotionStyle, wrapCreatureHtml } from "./htmlMonsterMotion.js";

export const HTML_LAYER_BOX = 256; // Must match HTML_CANVAS.

export function isInPlayWindow(sx, sy, rect, pad = HTML_LAYER_BOX) {
  if (!rect) return true;
  return sx >= rect.x - pad && sx <= rect.right + pad && sy >= rect.y - pad && sy <= rect.bottom + pad;
}

export function nodeStaticStyle() {
  return {
    position: "absolute",
    left: "0",
    top: "0",
    width: `${HTML_LAYER_BOX}px`,
    height: `${HTML_LAYER_BOX}px`,
    transformOrigin: "center center",
    pointerEvents: "none",
    willChange: "transform",
  };
}

export function nodeStyle({ sx, sy, size, opacity = 1, facing = 1, z = 0 }) {
  const scale = size / HTML_LAYER_BOX;
  const scaleX = facing < 0 ? -scale : scale;
  return {
    transform: `translate(${sx}px, ${sy}px) translate(-50%, -50%) scale(${scaleX}, ${scale})`,
    opacity: String(opacity),
    zIndex: String(z),
  };
}

export const STATE_CLASSES = ["tq-moving", "tq-attacking"];
export function stateClasses(state) {
  return { "tq-moving": state === "move", "tq-attacking": state === "attack" };
}

export function createHtmlMonsterLayer(mount) {
  const hasDom = typeof document !== "undefined" && !!mount;
  if (hasDom) ensureMonsterMotionStyle(document);
  const pool = new Map();
  const free = [];
  let frameSeq = 0;

  function acquire() {
    let el = free.pop();
    if (!el) {
      el = document.createElement("div");
      Object.assign(el.style, nodeStaticStyle());
      mount.appendChild(el);
    }
    el.style.display = "";
    return el;
  }

  function release(entry) {
    const el = entry.el;
    el.style.display = "none";
    el.innerHTML = "";
    el.classList.remove(...STATE_CLASSES);
    free.push(el);
  }

  function sync(monsters, { rect = null } = {}) {
    if (!hasDom) return;
    const seen = ++frameSeq;
    for (const m of monsters || []) {
      if (!m || m.id == null || !m.model) continue;
      if (!isInPlayWindow(m.sx, m.sy, rect)) continue;
      let entry = pool.get(m.id);
      if (!entry) { entry = { el: acquire(), model: null, state: null, variant: false, sx: NaN, sy: NaN, size: NaN, opacity: NaN, facing: NaN, z: NaN, seen: 0 }; pool.set(m.id, entry); }
      entry.seen = seen;
      const state = m.state || "base";
      // Toggle classes for state changes; re-setting innerHTML restarts the idle animation.
      const variant = (state !== "base" && m.model[state] && m.model[state] !== m.model.base) ? state : null;
      if (entry.model !== m.model) {
        entry.el.innerHTML = wrapCreatureHtml(pickStateHtml(m.model, "base"));
        entry.el.classList.remove(...STATE_CLASSES);
        entry.model = m.model; entry.state = "base"; entry.variant = false;
      }
      if (entry.state !== state || (variant ? !entry.variant : entry.variant)) {
        if (variant) {
          entry.el.innerHTML = wrapCreatureHtml(m.model[variant]);
          entry.el.classList.remove(...STATE_CLASSES);
        } else {
          if (entry.variant) entry.el.innerHTML = wrapCreatureHtml(pickStateHtml(m.model, "base"));
          const cls = stateClasses(state);
          for (const c of STATE_CLASSES) entry.el.classList.toggle(c, !!cls[c]);
        }
        entry.variant = !!variant;
        entry.state = state;
      }
      const op = m.opacity == null ? 1 : m.opacity, fc = m.facing == null ? 1 : m.facing, zz = m.z || 0;
      if (entry.sx !== m.sx || entry.sy !== m.sy || entry.size !== m.size || entry.opacity !== op || entry.facing !== fc || entry.z !== zz) {
        Object.assign(entry.el.style, nodeStyle(m));
        entry.sx = m.sx; entry.sy = m.sy; entry.size = m.size; entry.opacity = op; entry.facing = fc; entry.z = zz;
      }
    }
    let stale = null;
    for (const [id, entry] of pool) { if (entry.seen !== seen) (stale || (stale = [])).push(id); }
    for (const id of stale || []) {
      release(pool.get(id));
      pool.delete(id);
    }
  }

  function clear() {
    if (!hasDom) return;
    for (const id of [...pool.keys()]) { release(pool.get(id)); pool.delete(id); }
  }

  function destroy() {
    if (!hasDom) return;
    clear();
    for (const el of free) { try { el.remove(); } catch {} }
    free.length = 0;
  }

  return { sync, clear, destroy };
}
