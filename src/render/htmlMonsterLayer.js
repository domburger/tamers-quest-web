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
      if (!entry) { entry = { el: acquire(), model: null, state: null }; pool.set(m.id, entry); }
      const state = m.state || "base";
      // Re-set innerHTML only when the model or state actually changes — each state is a complete
      // fragment, so swapping it (re)starts that state's CSS animation, which is what we want for a
      // one-shot attack but must NOT happen every frame.
      if (entry.model !== m.model || entry.state !== state) {
        entry.el.innerHTML = pickStateHtml(m.model, state);
        entry.model = m.model;
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
