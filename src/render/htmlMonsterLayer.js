// TQ-262 (part of TQ-255): the live-DOM render path for HTML/CSS monster models. Each visible monster
// that carries a *sanitized* html model (see hasHtmlModel / htmlStates in src/systems/htmlModel.js, and
// the TQ-261 sanitizer) gets an absolutely-positioned, POOLED <div> overlaid on the play window and
// synced each frame to the monster's on-screen position. Monsters WITHOUT an html model are never
// touched here — they keep the existing rasterized-sprite path (drawMonster), so all current seed/AI
// content renders byte-identically. The path is additive and stays DORMANT until a monster actually
// carries a renderable html model.
//
// This module owns the overlay LIFECYCLE only (node pool, position sync, animation-state swap, cull) and
// is render-engine agnostic: the CALLER computes each monster's screen-space placement (from the
// kaboom/Phaser camera + canvas→CSS scale) and hands it in, plus the play-window rect for clipping. The
// pure helpers below carry the math and are unit-tested without a DOM; the thin DOM controller is a no-op
// where there is no document (tests/SSR). The wiring into the render loop + combat stage lands separately.
//
// SECURITY: this layer assigns model markup to innerHTML. It assumes the markup was already run through
// the TQ-261 sanitizer (sanitizeHtmlModel) before being stored on the monster. Callers MUST pass
// sanitized states only — never raw builder output.

import { pickStateHtml } from "../systems/htmlModel.js";
import { ensureMonsterMotionStyle, wrapCreatureHtml } from "./htmlMonsterMotion.js"; // TQ-386: default engine move/attack motion

export const HTML_LAYER_BOX = 256; // the authored canvas box (matches HTML_CANVAS); nodes scale from this

// Is a monster's screen-space centre inside (or near) the play window? Cull nodes fully outside the
// square + a pad so just-offscreen monsters pop in smoothly instead of at the hard edge. Pure; (sx,sy)
// and `rect` ({x,y,right,bottom}) are screen px. A null rect means "no clipping" (e.g. combat stage).
export function isInPlayWindow(sx, sy, rect, pad = HTML_LAYER_BOX) {
  if (!rect) return true;
  return sx >= rect.x - pad && sx <= rect.right + pad && sy >= rect.y - pad && sy <= rect.bottom + pad;
}

// The CSS placement for a node whose 256-box is drawn at `size` px on-screen, centred at (sx,sy) screen
// px, facing +1 (right) / -1 (left). We position by left/top + a centring translate so the same values
// work regardless of the box size, and scale the authored box down to `size`. Pure → returns a plain
// style object the controller Object.assigns onto the node.
export function nodeStyle({ sx, sy, size, opacity = 1, facing = 1, z = 0 }) {
  const scale = size / HTML_LAYER_BOX;
  const scaleX = facing < 0 ? -scale : scale; // mirror for left-facing; magnitude unchanged
  return {
    left: `${sx}px`,
    top: `${sy}px`,
    width: `${HTML_LAYER_BOX}px`,
    height: `${HTML_LAYER_BOX}px`,
    transform: `translate(-50%, -50%) scale(${scaleX}, ${scale})`,
    transformOrigin: "center center",
    opacity: String(opacity),
    zIndex: String(z),
  };
}

// TQ-310: map an action STATE to the semantic CSS classes the engine toggles on the live node, so the
// builder's own (sanitized, scoped) @keyframes can react — no engine-imposed motion, no builder JS.
// "idle"/"base" carry NO class (the looping idle @keyframes live on the base fragment, TQ-305); only the
// transient actions get a class. Pure → an {className: on} map the controller applies via classList.toggle.
export const STATE_CLASSES = ["tq-moving", "tq-attacking"];
export function stateClasses(state) {
  return { "tq-moving": state === "move", "tq-attacking": state === "attack" };
}

// Which pooled ids are no longer active and should be recycled this frame. Pure; `activeIds` may be a
// Set or any iterable, `pooledIds` any iterable (e.g. Map.keys()).
export function staleKeys(activeIds, pooledIds) {
  const active = activeIds instanceof Set ? activeIds : new Set(activeIds);
  return [...pooledIds].filter((id) => !active.has(id));
}

// The live overlay controller. `mount` is a DOM element the caller has positioned to exactly overlay the
// play-window canvas (the caller owns mounting/sizing/z-order so the overlay sits above the canvas but
// BEHIND the HUD gutters). Returns { sync, clear, destroy }. No-ops gracefully where there is no DOM.
//
//   sync(monsters, { rect })  — monsters: [{ id, model, state, sx, sy, size, opacity, facing }]
//     model  : the sanitized states object ({ base, idle?, attack?, move? })
//     state  : "base" | "idle" | "attack" | "move"  (defaults to "base")
//     sx,sy  : screen-px centre · size: on-screen px · facing: +1/-1 · opacity: 0..1
//     rect   : play-window rect for culling (omit/null = no cull, e.g. combat stage)
export function createHtmlMonsterLayer(mount) {
  const hasDom = typeof document !== "undefined" && !!mount;
  if (hasDom) ensureMonsterMotionStyle(document); // TQ-386: one-time default move/attack keyframes
  const pool = new Map(); // id -> { el, model, state }
  const free = [];        // recycled, detached-but-retained <div>s

  function acquire() {
    let el = free.pop();
    if (!el) {
      el = document.createElement("div");
      el.style.position = "absolute";
      el.style.pointerEvents = "none"; // overlay is purely visual; clicks fall through to the canvas
      el.style.willChange = "transform";
      mount.appendChild(el);
    }
    el.style.display = "";
    return el;
  }

  function release(entry) {
    const el = entry.el;
    el.style.display = "none";
    el.innerHTML = ""; // drop markup so a recycled node never flashes a stale creature
    el.classList.remove(...STATE_CLASSES); // TQ-310: clear action classes so a recycled node starts clean
    free.push(el);
  }

  function sync(monsters, { rect = null } = {}) {
    if (!hasDom) return;
    const active = new Set();
    for (const m of monsters || []) {
      if (!m || m.id == null || !m.model) continue;
      if (!isInPlayWindow(m.sx, m.sy, rect)) continue;
      active.add(m.id);
      let entry = pool.get(m.id);
      if (!entry) { entry = { el: acquire(), model: null, state: null, variant: false }; pool.set(m.id, entry); }
      const state = m.state || "base";
      // TQ-310: a new/changed model renders its BASE fragment ONCE (base carries the looping idle
      // @keyframes, TQ-305). A legacy model that authored a DISTINCT per-state fragment still swaps to it
      // (back-compat, pre-TQ-303 pose path). Otherwise — the base-only norm — the action state is
      // expressed by TOGGLING a semantic CLASS the builder's @keyframes react to; innerHTML is NEVER
      // re-set on a state change (that would restart the idle animation every move/attack).
      const variant = (state !== "base" && m.model[state] && m.model[state] !== m.model.base) ? state : null;
      if (entry.model !== m.model) {
        entry.el.innerHTML = wrapCreatureHtml(pickStateHtml(m.model, "base")); // TQ-386: wrap so .tq-moving/.tq-attacking drive the engine motion
        entry.el.classList.remove(...STATE_CLASSES);
        entry.model = m.model; entry.state = "base"; entry.variant = false;
      }
      if (entry.state !== state || (variant ? !entry.variant : entry.variant)) {
        if (variant) {
          entry.el.innerHTML = wrapCreatureHtml(m.model[variant]); // legacy distinct fragment → swap (restarts it)
          entry.el.classList.remove(...STATE_CLASSES);
        } else {
          if (entry.variant) entry.el.innerHTML = wrapCreatureHtml(pickStateHtml(m.model, "base")); // returning from a legacy variant → restore base (TQ-389: keep the .tq-mon-anim wrapper so TQ-386 motion keeps firing)
          const cls = stateClasses(state);
          for (const c of STATE_CLASSES) entry.el.classList.toggle(c, !!cls[c]);
        }
        entry.variant = !!variant;
        entry.state = state;
      }
      Object.assign(entry.el.style, nodeStyle(m));
    }
    for (const id of staleKeys(active, pool.keys())) {
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
    for (const el of free) { try { el.remove(); } catch { /* detached */ } }
    free.length = 0;
  }

  return { sync, clear, destroy };
}
